// Chrome traces for the Chronicles verification. A trace is recorded through
// Playwright's Chromium tracing around a window of interaction; each main-thread
// task longer than the threshold is then attributed to what ran inside it:
// script (by source file and function, through the build's source maps when
// present), garbage collection, style, layout, paint, compositing and waits on
// the GPU process. Only summaries leave this module: raw traces stay in memory.
import { readFile } from "node:fs/promises";
import sourceMapJs from "source-map-js";

const { SourceMapConsumer } = sourceMapJs;

export const TRACE_CATEGORIES = [
  "devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame",
  "toplevel", "blink.user_timing", "v8.execute", "disabled-by-default-v8.cpu_profiler", "v8", "blink", "gpu", "cc", "loading",
];

/** Starts a trace of the page's process. Playwright's Chromium tracing returns the trace on stop. */
export async function startTrace(browser, page, categories = TRACE_CATEGORIES) {
  await browser.startTracing(page, { categories });
}

/** Stops the trace and returns its events. */
export async function stopTrace(browser) {
  const buffer = await browser.stopTracing();
  const parsed = JSON.parse(buffer.toString("utf8"));
  return Array.isArray(parsed) ? parsed : parsed.traceEvents ?? [];
}

// Event names grouped by the kind of work they stand for. Anything else is "other".
const GROUPS = [
  ["gc", /(^|\.)(Major|Minor)GC|GCScavenger|GCMarkCompactor|GCIncremental|BlinkGC|ThreadState::|CppGC|V8\.GC/],
  ["script-compile", /^v8\.compile|V8\.Compile|v8\.parse|V8\.Parse|CompileCode|CompileLazy|v8\.produceCache|v8\.deserialize/],
  ["script", /^(FunctionCall|EvaluateScript|v8\.run|v8\.callFunction|V8\.Execute|RunMicrotasks|FireAnimationFrame|TimerFire|EventDispatch|HandlePostMessage|v8\.evaluateModule|ResourceReceivedData|XHRReadyStateChange)$/],
  ["style", /^(UpdateLayoutTree|RecalculateStyles|ParseAuthorStyleSheet|StyleRecalc|Document::updateStyle|ScheduleStyleRecalculation)/],
  ["layout", /^(Layout|LocalFrameView::layout|UpdateLayout|LayoutShift|IntersectionObserverController)/],
  ["paint", /^(Paint|PrePaint|PaintImage|Decode Image|ImageDecodeTask|Rasterize|RasterTask|PaintSetup|DecodeLazyPixelRef)/],
  ["composite", /^(Layerize|UpdateLayer|UpdateLayerTree|CompositeLayers|Commit|ProxyMain::|LayerTreeHost::|cc::|PaintArtifactCompositor|Animation)/],
  ["gpu-wait", /CommandBuffer|WaitForGetOffset|WaitSyncToken|GpuChannelHost|SharedImage|GLES2|WebGL|DrawingBuffer|Flush|SwapBuffers|GpuMemoryBuffer|ReadPixels|TexImage/],
];

export const groupOf = (name) => GROUPS.find(([, pattern]) => pattern.test(name))?.[0] ?? "other";

const TASK_NAMES = new Set(["RunTask", "ThreadControllerImpl::RunTask"]);

function mainThreadOf(events) {
  const names = new Map();
  for (const event of events) if (event.ph === "M" && event.name === "thread_name" && event.args?.name === "CrRendererMain") names.set(`${event.pid}:${event.tid}`, true);
  const counts = new Map();
  for (const event of events) {
    const key = `${event.pid}:${event.tid}`;
    if (names.has(key) && event.ph === "X") counts.set(key, (counts.get(key) || 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!best) return null;
  const [pid, tid] = best.split(":").map(Number);
  return { pid, tid };
}

// Self time per event, nesting complete events by containment.
function selfTimes(events) {
  const sorted = events.slice().sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const stack = [];
  const result = new Map();
  for (const event of sorted) {
    while (stack.length && stack[stack.length - 1].ts + stack[stack.length - 1].dur <= event.ts) stack.pop();
    const parent = stack[stack.length - 1];
    result.set(event, event.dur);
    if (parent) result.set(parent, result.get(parent) - event.dur);
    stack.push(event);
  }
  return result;
}

// CPU profile samples of one thread: [time in µs, node] pairs plus the node table.
function profileSamples(events, thread) {
  const profiles = new Map();
  for (const event of events) {
    if (event.pid !== thread.pid) continue;
    if (event.name === "Profile" && event.args?.data?.startTime !== undefined) {
      profiles.set(event.id, { tid: event.tid, time: event.args.data.startTime, nodes: new Map(), samples: [] });
    }
  }
  for (const event of events) {
    if (event.pid !== thread.pid || event.name !== "ProfileChunk") continue;
    const profile = profiles.get(event.id);
    if (!profile) continue;
    const data = event.args?.data ?? {};
    for (const node of data.cpuProfile?.nodes ?? []) profile.nodes.set(node.id, node);
    const samples = data.cpuProfile?.samples ?? [], deltas = data.timeDeltas ?? [];
    for (let index = 0; index < samples.length; index++) {
      profile.time += deltas[index] ?? 0;
      profile.samples.push([profile.time, samples[index]]);
    }
  }
  const chosen = [...profiles.values()].find((profile) => profile.tid === thread.tid) ?? [...profiles.values()].sort((a, b) => b.samples.length - a.samples.length)[0];
  return chosen ?? { nodes: new Map(), samples: [] };
}

/** Reads source maps for built chunks from a dist directory, keyed by the chunk's file name. */
export function distSourceMaps(directory) {
  const cache = new Map();
  return async (url) => {
    const file = url.split("?")[0].split("/").pop();
    if (!file || !file.endsWith(".js")) return null;
    if (!cache.has(file)) cache.set(file, readFile(`${directory}/assets/${file}.map`, "utf8").then((text) => new SourceMapConsumer(JSON.parse(text))).catch(() => null));
    return cache.get(file);
  };
}

// A short source label: the package for dependencies, the path inside src for our code.
function sourceLabel(source) {
  if (!source) return "(unmapped)";
  const clean = source.replace(/^(\.\.\/)+/, "").replace(/^webpack:\/\/\//, "");
  const dependency = clean.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (dependency) return dependency[1];
  const own = clean.match(/(src\/.*|shared\/.*)$/);
  return own ? own[1] : clean;
}

async function frameLabel(frame, resolve) {
  const url = frame.url || "";
  if (!url) return { file: frame.functionName ? `(native ${frame.functionName})` : "(native)", fn: frame.functionName || "(anonymous)" };
  const consumer = resolve ? await resolve(url) : null;
  if (consumer && frame.lineNumber >= 0) {
    const position = consumer.originalPositionFor({ line: frame.lineNumber + 1, column: Math.max(0, frame.columnNumber) });
    if (position?.source) return { file: sourceLabel(position.source), fn: position.name || frame.functionName || "(anonymous)", line: position.line };
  }
  return { file: url.split("?")[0].split("/").pop(), fn: frame.functionName || "(anonymous)" };
}

const round = (value, digits = 1) => Number(value.toFixed(digits));
const top = (map, count) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, count);

/**
 * Attributes main-thread long tasks in a time window.
 * - from/to: performance.now() milliseconds of the page, translated through `clock`
 *   (the trace timestamp in µs of performance.now() = 0), or omitted for the whole trace.
 * - marks: user timing marks found in the trace are listed against each task.
 */
export async function attributeLongTasks(events, { threshold = 50, from, to, resolveSourceMap, sync } = {}) {
  const thread = mainThreadOf(events);
  if (!thread) return { thread: null, clock: null, longTasks: [] };
  const threadEvents = events.filter((event) => event.pid === thread.pid && event.tid === thread.tid && event.ph === "X" && typeof event.dur === "number");
  const marks = events.filter((event) => event.pid === thread.pid && (event.cat || "").includes("blink.user_timing") && event.ph !== "M" && !/^(navigationStart|fetchStart|responseEnd|domLoading|domInteractive|domComplete|loadEventStart|loadEventEnd|unloadEvent|requestStart|responseStart|domContentLoaded)/.test(event.name));
  // The page's performance.now() on the trace clock: a mark made at a known
  // performance.now() value (`sync`) pins it; otherwise the navigation start does.
  const syncMark = sync ? marks.find((mark) => mark.name === sync.name) : null;
  const navigation = events.filter((event) => event.pid === thread.pid && event.name === "navigationStart").sort((a, b) => b.ts - a.ts)[0];
  const clock = syncMark ? syncMark.ts - sync.at * 1000 : navigation ? navigation.ts : null;
  const markTime = (event) => event.ts;
  const windowStart = from !== undefined && clock !== null ? clock + from * 1000 : -Infinity;
  const windowEnd = to !== undefined && clock !== null ? clock + to * 1000 : Infinity;
  const tasks = threadEvents.filter((event) => TASK_NAMES.has(event.name) && event.dur >= threshold * 1000 && event.ts >= windowStart && event.ts <= windowEnd)
    .sort((a, b) => a.ts - b.ts)
    .filter((event, index, list) => !list.slice(0, index).some((other) => other.ts <= event.ts && other.ts + other.dur >= event.ts + event.dur));
  const profile = profileSamples(events, thread);
  const results = [];
  for (const task of tasks) {
    const inside = threadEvents.filter((event) => event !== task && event.ts >= task.ts && event.ts + event.dur <= task.ts + task.dur + 1);
    const self = selfTimes([task, ...inside]);
    const byName = new Map(), byGroup = new Map();
    for (const [event, time] of self) {
      if (event === task) continue;
      byName.set(event.name, (byName.get(event.name) || 0) + time);
      const group = groupOf(event.name);
      byGroup.set(group, (byGroup.get(group) || 0) + time);
    }
    const untraced = self.get(task) ?? 0;
    if (untraced > 0) byGroup.set("untraced", untraced);
    const first = inside.sort((a, b) => a.ts - b.ts)[0];
    const trigger = first ? `${first.name}${first.args?.data?.type ? ` (${first.args.data.type})` : ""}${first.args?.data?.functionName ? ` ${first.args.data.functionName}` : ""}` : task.name;
    // Script attribution from CPU samples: the leaf frame (self) and every source file on the stack (inclusive).
    const selfFiles = new Map(), selfFunctions = new Map(), inclusiveFiles = new Map();
    let sampled = 0;
    for (const [time, nodeId] of profile.samples) {
      if (time < task.ts || time > task.ts + task.dur) continue;
      sampled++;
      let node = profile.nodes.get(nodeId);
      const leaf = node ? await frameLabel(node.callFrame ?? {}, resolveSourceMap) : { file: "(unknown)", fn: "(unknown)" };
      selfFiles.set(leaf.file, (selfFiles.get(leaf.file) || 0) + 1);
      selfFunctions.set(`${leaf.fn} @ ${leaf.file}`, (selfFunctions.get(`${leaf.fn} @ ${leaf.file}`) || 0) + 1);
      const seen = new Set();
      while (node) {
        const label = await frameLabel(node.callFrame ?? {}, resolveSourceMap);
        if (!seen.has(label.file)) {
          seen.add(label.file);
          inclusiveFiles.set(label.file, (inclusiveFiles.get(label.file) || 0) + 1);
        }
        node = node.parent !== undefined ? profile.nodes.get(node.parent) : null;
      }
    }
    const share = (count) => round((count / Math.max(1, sampled)) * 100);
    const nearestMark = marks.filter((mark) => markTime(mark) <= task.ts + task.dur).sort((a, b) => markTime(b) - markTime(a))[0];
    results.push({
      startMs: clock !== null ? round((task.ts - clock) / 1000) : null,
      durationMs: round(task.dur / 1000),
      trigger,
      afterMark: nearestMark ? { name: nearestMark.name, msBeforeTaskStart: round((task.ts - markTime(nearestMark)) / 1000) } : null,
      groupsMs: Object.fromEntries(top(byGroup, 12).map(([name, time]) => [name, round(time / 1000)])),
      eventsMs: Object.fromEntries(top(byName, 14).map(([name, time]) => [name, round(time / 1000)])),
      samples: sampled,
      scriptSelfByFilePercent: Object.fromEntries(top(selfFiles, 10).map(([name, count]) => [name, share(count)])),
      scriptInclusiveByFilePercent: Object.fromEntries(top(inclusiveFiles, 12).map(([name, count]) => [name, share(count)])),
      topSelfFunctionsPercent: Object.fromEntries(top(selfFunctions, 12).map(([name, count]) => [name, share(count)])),
    });
  }
  return { thread, clock, longTasks: results };
}

/** Self time per group over a window of the main thread, for context beside the long tasks. */
export function mainThreadBusy(events, { from, to } = {}) {
  const thread = mainThreadOf(events);
  if (!thread) return null;
  const tasks = events.filter((event) => event.pid === thread.pid && event.tid === thread.tid && event.ph === "X" && TASK_NAMES.has(event.name)
    && (from === undefined || event.ts >= from) && (to === undefined || event.ts <= to));
  const total = tasks.reduce((sum, task) => sum + task.dur, 0);
  return { tasks: tasks.length, busyMs: round(total / 1000), longestMs: round(Math.max(0, ...tasks.map((task) => task.dur)) / 1000) };
}

/**
 * Script time per frame on the page's main thread: the animation-frame
 * callbacks run inside each BeginMainFrame, summed per frame, in milliseconds.
 * `from`/`to` are performance.now() values pinned through `sync` as in attributeLongTasks.
 */
export function frameScriptTimes(events, { from, to, sync } = {}) {
  const thread = mainThreadOf(events);
  if (!thread) return [];
  const onThread = events.filter((event) => event.pid === thread.pid && event.tid === thread.tid && event.ph === "X" && typeof event.dur === "number");
  const syncMark = sync ? events.find((event) => event.pid === thread.pid && event.name === sync.name) : null;
  const clock = syncMark ? syncMark.ts - sync.at * 1000 : null;
  const start = from !== undefined && clock !== null ? clock + from * 1000 : -Infinity;
  const end = to !== undefined && clock !== null ? clock + to * 1000 : Infinity;
  const frames = onThread.filter((event) => event.name === "ProxyMain::BeginMainFrame" && event.ts >= start && event.ts <= end);
  const callbacks = onThread.filter((event) => event.name === "FireAnimationFrame" && event.ts >= start && event.ts <= end);
  return frames.map((frame) => round(callbacks
    .filter((callback) => callback.ts >= frame.ts && callback.ts + callback.dur <= frame.ts + frame.dur + 1)
    .reduce((sum, callback) => sum + callback.dur, 0) / 1000, 2));
}

/** Nearest-rank percentiles of a list of numbers. */
export function percentiles(values, ranks = [50, 95, 99]) {
  const sorted = values.slice().sort((a, b) => a - b);
  const pick = (rank) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((rank / 100) * sorted.length) - 1))] : null);
  return Object.fromEntries(ranks.map((rank) => [`p${rank}`, pick(rank)]));
}
