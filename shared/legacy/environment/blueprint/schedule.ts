// Deterministic NPC schedules. An agent walks its route and holds at waypoints in a
// fixed loop; the renderer passes elapsed seconds and reads a pose. Sampling never
// allocates, so the Quest frame loop can call it for every visible agent.

import type { ActivityKind, NpcAgent } from "./types";

export interface CompiledSchedule {
  readonly agent: NpcAgent;
  readonly cycleSeconds: number;
  /** Route waypoints as flat x,z pairs and the arc length at each waypoint. */
  readonly xz: Float64Array;
  readonly cumulative: Float64Array;
  readonly totalLength: number;
  /** Per segment: start time, end time, start arc length, end arc length. */
  readonly t0: Float64Array;
  readonly t1: Float64Array;
  readonly s0: Float64Array;
  readonly s1: Float64Array;
  /** Per segment: null for walking, the activity for holds. */
  readonly activity: readonly (ActivityKind | null)[];
  /** Per segment: facing bearing for holds (NaN for walks, which face their direction of travel). */
  readonly faceBearing: Float64Array;
}

/** Mutable pose filled by sampleAgent (reuse one per agent). */
export interface AgentPose {
  x: number;
  z: number;
  /** Arc length along the route, for elevated deck interpolation. */
  s: number;
  /** Compass bearing the agent faces. */
  bearingDeg: number;
  /** Current activity ("patrol"/"carry"/... while walking is reported as "walk"). */
  activity: ActivityKind | "walk";
  /** 0..1 progress through the current step (drives animation phase). */
  stepProgress: number;
}

export function createAgentPose(): AgentPose {
  return { x: 0, z: 0, s: 0, bearingDeg: 0, activity: "walk", stepProgress: 0 };
}

export function compileSchedule(agent: NpcAgent): CompiledSchedule {
  const n = agent.route.length;
  const xz = new Float64Array(n * 2);
  const cumulative = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xz[i * 2] = agent.route[i][0];
    xz[i * 2 + 1] = agent.route[i][1];
    if (i > 0) {
      const dx = xz[i * 2] - xz[i * 2 - 2];
      const dz = xz[i * 2 + 1] - xz[i * 2 - 1];
      cumulative[i] = cumulative[i - 1] + Math.sqrt(dx * dx + dz * dz);
    }
  }
  const count = agent.steps.length;
  const t0 = new Float64Array(count);
  const t1 = new Float64Array(count);
  const s0 = new Float64Array(count);
  const s1 = new Float64Array(count);
  const faceBearing = new Float64Array(count);
  const activity: (ActivityKind | null)[] = [];
  let t = 0;
  let cur = 0;
  // Holds without an explicit facing keep the bearing of the last leg walked.
  let lastBearing = n > 1 ? bearingOf(xz[2] - xz[0], xz[3] - xz[1]) : 180;
  for (let i = 0; i < count; i++) {
    const step = agent.steps[i];
    t0[i] = t;
    s0[i] = cumulative[cur];
    if (step.kind === "walk") {
      const to = Math.max(0, Math.min(n - 1, step.to));
      const d = Math.abs(cumulative[to] - cumulative[cur]);
      const speed = step.speed ?? agent.speed;
      t += speed > 0 ? d / speed : 0;
      s1[i] = cumulative[to];
      activity.push(null);
      faceBearing[i] = NaN;
      if (to !== cur) {
        const prev = to > cur ? to - 1 : to + 1;
        lastBearing = bearingOf(xz[to * 2] - xz[prev * 2], xz[to * 2 + 1] - xz[prev * 2 + 1]);
      }
      cur = to;
    } else {
      t += step.seconds;
      s1[i] = cumulative[cur];
      activity.push(step.activity);
      faceBearing[i] = step.faceBearingDeg ?? lastBearing;
    }
    t1[i] = t;
  }
  return { agent, cycleSeconds: t, xz, cumulative, totalLength: n > 0 ? cumulative[n - 1] : 0, t0, t1, s0, s1, activity, faceBearing };
}

function bearingOf(dx: number, dz: number): number {
  const b = (Math.atan2(dx, -dz) * 180) / Math.PI;
  return b < 0 ? b + 360 : b;
}

/** Fill `out` with the agent's pose at elapsed time `seconds`. Allocation-free. */
export function sampleAgent(c: CompiledSchedule, seconds: number, out: AgentPose): AgentPose {
  if (c.cycleSeconds <= 0 || c.t0.length === 0) {
    out.x = c.xz[0];
    out.z = c.xz[1];
    out.s = 0;
    out.activity = "rest";
    out.stepProgress = 0;
    return out;
  }
  let tm = (seconds + c.agent.phaseSeconds) % c.cycleSeconds;
  if (tm < 0) tm += c.cycleSeconds;
  let seg = 0;
  while (seg < c.t1.length - 1 && tm >= c.t1[seg]) seg++;
  const dur = c.t1[seg] - c.t0[seg];
  const u = dur > 0 ? (tm - c.t0[seg]) / dur : 1;
  const s = c.s0[seg] + (c.s1[seg] - c.s0[seg]) * u;
  // Locate s on the route.
  const cum = c.cumulative;
  const n = cum.length;
  let i = 1;
  while (i < n - 1 && cum[i] < s) i++;
  const a = i - 1;
  const len = cum[i] - cum[a];
  const f = len > 0 ? (s - cum[a]) / len : 0;
  const ax = c.xz[a * 2];
  const az = c.xz[a * 2 + 1];
  const bx = c.xz[i * 2];
  const bz = c.xz[i * 2 + 1];
  out.x = ax + (bx - ax) * f;
  out.z = az + (bz - az) * f;
  out.s = s;
  out.stepProgress = u;
  const act = c.activity[seg];
  if (act === null) {
    out.activity = "walk";
    const dir = c.s1[seg] >= c.s0[seg] ? 1 : -1;
    if (len > 0) out.bearingDeg = bearingOf((bx - ax) * dir, (bz - az) * dir);
  } else {
    out.activity = act;
    out.bearingDeg = c.faceBearing[seg];
  }
  return out;
}
