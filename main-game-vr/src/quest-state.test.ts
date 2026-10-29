import assert from "node:assert/strict";
import test from "node:test";
import { CHRONICLE_EXHIBITS, CHRONICLE_LABELS, CHRONICLE_RECORDS, CHRONICLES_TITLE, getChronicleRecords, getHotspotRecords } from "../../shared/chronicles/content";
import { RELIEF_SEGMENTS, buildReliefMesh, imageToRelief, intersectRelief, reliefHeightAt, reliefToImage } from "../../shared/chronicles/archive/relief";
import { CHRONICLES_SCENE_FIXTURE } from "../../shared/chronicles/scene-state.fixture";
import { canUnwind, createChroniclesScene } from "../../shared/chronicles/scene-state";
import type { ChroniclesSceneEvent } from "../../shared/chronicles/types";
import { ARCHIVE_BLUEPRINT } from "../../shared/chronicles/archive/blueprint";
import { CHRONICLES_PANEL, CHRONICLES_PANEL_LIFT, chroniclesPanelPose, controlSurfaceCheck, panelDegrees } from "./chronicles/control-surface";
import { ARENAS, CHAPTERS, SETTINGS_CATEGORIES, getModalContent } from "../../shared/menu/content";
import {
  DEFAULT_QUEST_PREFERENCES, QUEST_PREFERENCES_KEY, QUEST_VISIT_STEPS,
  adjustQuestPreference, createQuestState, getQuestSettingsRows,
  normalizeQuestPreferences, reduceQuestState,
} from "./quest-state";
import type { QuestEvent, QuestState } from "./quest-state";
import { QUEST_UI_LAYOUT, questText } from "./ui-contract";

const apply = (state: QuestState, ...events: QuestEvent[]) => events.reduce(reduceQuestState, state);
const play = () => reduceQuestState(createQuestState(), { type: "nav", screen: "play" });
const chronicles = () => reduceQuestState(createQuestState(), { type: "home", panel: "chronicles" });

test("Quest preferences validate independently of unsafe desktop render controls", () => {
  assert.deepEqual(normalizeQuestPreferences(undefined), DEFAULT_QUEST_PREFERENCES);
  for (const invalid of [null, false, [], "saved", 1]) assert.deepEqual(normalizeQuestPreferences(invalid), DEFAULT_QUEST_PREFERENCES);
  const prefs = normalizeQuestPreferences({ motion: false, quality: "ultra", showHints: false, textScale: 999, panelDistance: 0,
    posture: "walking", contrast: "high", volume: 1000, frameLimit: 30, renderScale: 10, fullscreen: true });
  assert.equal(prefs.motion, false); assert.equal(prefs.showHints, false); assert.equal(prefs.contrast, "high");
  assert.equal(prefs.quality, "medium"); assert.equal(prefs.textScale, 100); assert.equal(prefs.panelDistance, 1.5);
  assert.equal(prefs.posture, "seated"); assert.equal(prefs.volume, 100);
  assert.equal("frameLimit" in prefs, false); assert.equal("renderScale" in prefs, false);
  assert.equal(normalizeQuestPreferences({ volume: -50 }).volume, 0);
  assert.equal(normalizeQuestPreferences({ volume: NaN }).volume, 65);
  assert.equal(normalizeQuestPreferences({ volume: Infinity }).volume, 65);
  assert.equal(QUEST_PREFERENCES_KEY, "crownfall.quest.preferences");
});

test("all supported adjustments are bounded cycles and read-only IDs cannot mutate", () => {
  const prefs = normalizeQuestPreferences(DEFAULT_QUEST_PREFERENCES);
  for (const [id, key, count] of [
    ["ambient-motion", "motion", 2], ["show-hints", "showHints", 2], ["contrast", "contrast", 2],
    ["quality", "quality", 3], ["text-scale", "textScale", 3], ["panel-distance", "panelDistance", 3], ["posture", "posture", 2],
  ] as const) {
    let changed = prefs;
    for (let index = 0; index < count; index++) changed = adjustQuestPreference(changed, id);
    assert.deepEqual(changed, prefs, `${id} cycle returns to start`);
    assert.notEqual(adjustQuestPreference(prefs, id)[key], prefs[key]);
  }
  assert.equal(adjustQuestPreference(prefs, "headset-frame-rate"), prefs);
  assert.equal(adjustQuestPreference(prefs, "unknown"), prefs);
  assert.equal(adjustQuestPreference({ ...prefs, volume: 98 }, "master-volume").volume, 100);
  assert.equal(adjustQuestPreference({ ...prefs, volume: 100 }, "master-volume").volume, 0);
});

test("all six settings pages are hand-readable and advertise only supported actions", () => {
  const prefs = normalizeQuestPreferences(DEFAULT_QUEST_PREFERENCES);
  for (const category of SETTINGS_CATEGORIES) {
    const rows = getQuestSettingsRows(category, prefs, "Left hand tracked");
    assert.ok(rows.length > 0 && rows.length <= 10);
    assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
    for (const row of rows) {
      assert.ok(row.label && row.value && row.description);
      if (row.action) assert.notEqual(adjustQuestPreference(prefs, row.action), prefs);
    }
  }
  const video = getQuestSettingsRows("video", prefs);
  assert.equal(video.some(row => /fullscreen|vsync|frame-limit|resolution-scale/.test(row.id)), false);
  assert.ok(video.filter(row => /headset-/.test(row.id)).every(row => !row.action));
  assert.equal(getQuestSettingsRows("input", prefs, "Left hand tracked")[0].value, "Left hand tracked");
  assert.match(getQuestSettingsRows("audio", prefs)[0].description, /not connected/);
  assert.match(getQuestSettingsRows("controls", prefs).map(row => row.description).join(" "), /do not need to pair a controller/);
});

test("modal previews gate behind-menu actions without starting gameplay", () => {
  const state = reduceQuestState(play(), { type: "play", id: "classic" });
  assert.equal(state.modal, "classic");
  for (const event of [
    { type: "nav", screen: "home" }, { type: "play", id: "chapters" }, { type: "chapter", index: 0 },
    { type: "start-visit" }, { type: "category", category: "video" },
  ] satisfies QuestEvent[]) assert.equal(reduceQuestState(state, event), state);
  for (const type of ["confirm", "cancel", "back"] as const) {
    const closed = reduceQuestState(state, { type });
    assert.equal(closed.modal, null); assert.equal(closed.screen, "play");
  }
  const quit = reduceQuestState(play(), { type: "back" });
  assert.equal(quit.modal, "quit");
  assert.equal(reduceQuestState(quit, { type: "cancel" }).screen, "play");
  assert.equal(reduceQuestState(quit, { type: "confirm" }).screen, "home");
  assert.equal(reduceQuestState(createQuestState(), { type: "play", id: "classic" }).modal, null, "hidden mode action is rejected");
});

test("all supplied Home destinations and modes keep truthful preview behavior", () => {
  for (const panel of ["legacy", "herald"] as const) {
    const state = reduceQuestState(createQuestState(), { type: "home", panel });
    assert.equal(state.modal, panel); assert.match(getModalContent(panel).description, /unavailable in this build/);
    assert.equal(reduceQuestState(state, { type: "confirm" }).screen, "home");
  }
  for (const id of ["classic", "local-duel", "online-duel"] as const) {
    const state = reduceQuestState(play(), { type: "play", id });
    assert.equal(state.modal, id); assert.equal(reduceQuestState(state, { type: "confirm" }).screen, "play");
  }
});

test("only first two chapter previews open; locks and invalid indexes never launch", () => {
  const chapters = reduceQuestState(play(), { type: "play", id: "chapters" });
  assert.equal(chapters.screen, "chapters");
  for (let index = 0; index < CHAPTERS.length; index++) {
    const selected = reduceQuestState(chapters, { type: "chapter", index });
    assert.equal(selected.chapterIndex, index);
    assert.equal(selected.modal, index < 2 ? "chapter-preview" : null);
    assert.equal(selected.screen, "chapters");
  }
  for (const index of [-1, CHAPTERS.length, NaN, Infinity, 0.5]) assert.equal(reduceQuestState(chapters, { type: "chapter", index }), chapters);
  assert.equal(reduceQuestState(chapters, { type: "back" }).screen, "play");
});

test("Showcase and Settings detail Back paths retain origin and selection", () => {
  let state = apply(play(), { type: "nav", screen: "showcase" }, { type: "showcase", view: "arenas" }, { type: "arena", index: 3 });
  assert.equal(state.arenaIndex, 3);
  for (const index of [-1, ARENAS.length, 0.5]) assert.equal(reduceQuestState(state, { type: "arena", index }), state);
  state = reduceQuestState(state, { type: "back" }); assert.equal(state.screen, "showcase");
  state = reduceQuestState(state, { type: "back" }); assert.equal(state.screen, "play");
  state = apply(state, { type: "nav", screen: "settings" }, { type: "category", category: "video" });
  assert.equal(state.settingsCategory, "video");
  state = apply(state, { type: "nav", screen: "showcase" }, { type: "showcase", view: "replays" });
  assert.equal(state.screen, "library"); assert.equal(state.library, "replays");
  state = apply(state, { type: "back" }, { type: "back" });
  assert.equal(state.screen, "settings"); assert.equal(state.settingsCategory, "video");
  state = reduceQuestState(state, { type: "back" }); assert.equal(state.settingsCategory, null);
  state = reduceQuestState(state, { type: "back" }); assert.equal(state.screen, "play");
  const fromHome = apply(createQuestState(), { type: "nav", screen: "settings" }, { type: "nav", screen: "settings" }, { type: "back" });
  assert.equal(fromHome.screen, "home", "reselecting Settings does not overwrite the Home origin");
});

test("pause, repeat pause, exit and re-entry retain the exact underlying dialog context", () => {
  const original = apply(play(), { type: "play", id: "chapters" }, { type: "chapter", index: 1 });
  let state = reduceQuestState({ ...original, entered: true }, { type: "pause", reason: "Hands out of view" });
  assert.equal(state.screen, "pause"); assert.equal(state.previousScreen, "chapters"); assert.equal(state.modal, "chapter-preview");
  state = reduceQuestState(state, { type: "pause", reason: "Session hidden" });
  assert.equal(state.previousScreen, "chapters");
  for (const event of [{ type: "confirm" }, { type: "cancel" }, { type: "back" }, { type: "nav", screen: "home" }] satisfies QuestEvent[]) assert.equal(reduceQuestState(state, event), state);
  state = reduceQuestState(state, { type: "exit" }); assert.equal(state.entered, false);
  state = reduceQuestState(state, { type: "enter", firstVisit: false }); assert.equal(state.paused, true); assert.equal(state.entered, true);
  state = reduceQuestState(state, { type: "resume" });
  assert.equal(state.screen, "chapters"); assert.equal(state.modal, "chapter-preview"); assert.equal(state.chapterIndex, 1); assert.equal(state.pauseReason, "");
  const home = apply(state, { type: "pause", reason: "Break" }, { type: "pause-home" });
  assert.equal(home.screen, "home"); assert.equal(home.modal, null); assert.equal(home.paused, false);
});

test("short visit requires three real steps and explicit Finish, with no timer or fake progress", () => {
  let state = reduceQuestState(createQuestState(), { type: "enter", firstVisit: true });
  assert.equal(state.screen, "onboarding"); assert.equal(state.entered, true);
  state = reduceQuestState(state, { type: "start-visit" });
  assert.equal(state.screen, "visit"); assert.equal(state.visitStep, 0); assert.equal(QUEST_VISIT_STEPS, 3);
  assert.equal(reduceQuestState(state, { type: "visit-finish" }), state);
  assert.equal(reduceQuestState(state, { type: "visit-back" }), state);
  state = reduceQuestState(state, { type: "visit-next" });
  const stepOne = state;
  state = apply(state, { type: "pause", reason: "Break" }, { type: "resume" });
  assert.equal(state.visitStep, stepOne.visitStep); assert.equal(state.screen, "visit");
  state = reduceQuestState(state, { type: "exit" });
  state = reduceQuestState(state, { type: "enter", firstVisit: false }); assert.equal(state.visitStep, 1);
  state = reduceQuestState(state, { type: "visit-next" });
  assert.equal(state.visitStep, 2); assert.equal(reduceQuestState(state, { type: "visit-next" }), state);
  state = reduceQuestState(state, { type: "visit-finish" });
  assert.equal(state.visitComplete, true); assert.equal(state.screen, "visit");
  assert.equal(reduceQuestState(state, { type: "visit-next" }), state);
  assert.equal(reduceQuestState(state, { type: "back" }).screen, "home");
  const restarted = reduceQuestState(state, { type: "start-visit" }); assert.equal(restarted.visitStep, 0); assert.equal(restarted.visitComplete, false);
  assert.equal(reduceQuestState(restarted, { type: "skip-visit" }).screen, "home");
});

test("the Chronicles Home tile opens the archive at the Atlas, not a dialog", () => {
  const state = chronicles();
  assert.equal(state.screen, "chronicles"); assert.equal(state.modal, null);
  assert.deepEqual(state.chronicles, createChroniclesScene(), "the Atlas overview, nothing open, while the archive builds");
  assert.equal(reduceQuestState(play(), { type: "home", panel: "chronicles" }).screen, "play", "only Home opens Chronicles");
  for (const event of [
    { type: "exhibit", exhibit: "laws" }, { type: "record", id: "korvenia" }, { type: "map", x: 0.15, y: 0.17 },
    { type: "focus", focus: { kind: "nation", nation: "korvenia" } }, { type: "loaded", result: "ready" }, { type: "close-record" },
  ] satisfies QuestEvent[]) {
    const home = createQuestState();
    assert.equal(reduceQuestState(home, event), home, `${event.type} is ignored outside Chronicles`);
  }
});

test("exhibits switch, each kind of record opens, and records stay within their exhibit", () => {
  let state = chronicles();
  for (const exhibit of CHRONICLE_EXHIBITS) {
    state = reduceQuestState(state, { type: "exhibit", exhibit: exhibit.id });
    assert.equal(state.chronicles.collection, exhibit.id); assert.equal(state.chronicles.entryId, null);
    for (const record of getChronicleRecords(exhibit.id)) {
      state = reduceQuestState(state, { type: "record", id: record.id });
      assert.equal(state.chronicles.entryId, record.id); assert.equal(state.screen, "chronicles");
    }
    const other = CHRONICLE_EXHIBITS.find(item => item.id !== exhibit.id)!;
    assert.equal(reduceQuestState(state, { type: "record", id: getChronicleRecords(other.id)[0].id }), state, "another exhibit's record is rejected");
    assert.equal(reduceQuestState(state, { type: "record", id: "unknown" }), state);
    const switched = reduceQuestState(state, { type: "exhibit", exhibit: other.id });
    assert.equal(switched.chronicles.collection, other.id); assert.equal(switched.chronicles.entryId, null, "switching exhibits closes the record");
  }
  assert.equal(reduceQuestState(state, { type: "exhibit", exhibit: "unknown" as "atlas" }), state);
  assert.equal(reduceQuestState(state, { type: "exhibit", exhibit: "contested" }), state, "the dormant Contested Record has no tab to open");
  state = reduceQuestState(state, { type: "record", id: "the-muster" });
  assert.equal(reduceQuestState(state, { type: "close-record" }).chronicles.entryId, null);
});

test("each map hotspot opens its nation while empty ground and the centre do nothing", () => {
  const atlas = chronicles();
  for (const record of getHotspotRecords()) {
    const hit = reduceQuestState(atlas, { type: "map", x: record.hotspot.x, y: record.hotspot.y });
    assert.equal(hit.chronicles.entryId, record.id);
    assert.deepEqual(hit.chronicles.focus, { kind: "nation", nation: record.nation }, "a hotspot brings its nation's focus");
    assert.equal(reduceQuestState(atlas, { type: "record", id: record.id }).chronicles.entryId, record.id);
  }
  for (const [x, y] of [[0.5, 0.5], [0.45, 0.4], [0.02, 0.95], [NaN, 0.2], [-1, -1]]) {
    assert.equal(reduceQuestState(atlas, { type: "map", x, y }), atlas, `empty ground at ${x}, ${y}`);
  }
  const laws = reduceQuestState(atlas, { type: "exhibit", exhibit: "laws" });
  assert.equal(reduceQuestState(laws, { type: "map", x: 0.15, y: 0.17 }), laws, "the map only answers on the Atlas");
});

test("a ray onto the Atlas diorama's bare ground selects only where a hotspot is", () => {
  // The diorama refines a ray on its ground stand-in against the drawn surface,
  // then dispatches the hit as map fractions; a seated eye looks down from the south.
  const width = 0.95, mesh = buildReliefMesh(width, RELIEF_SEGMENTS.quest), eye = [0, 0.5, mesh.depth / 2 + 0.36] as const;
  const pick = (x: number, y: number) => {
    const [tx, tz] = imageToRelief(x, y, width), ty = reliefHeightAt(x, y) * width;
    const t = intersectRelief(mesh, eye[0], eye[1], eye[2], tx - eye[0], ty - eye[1], tz - eye[2]);
    assert.ok(t > 0, `the ray reaches the relief at ${x}, ${y}`);
    const [hx, hy] = reliefToImage(eye[0] + (tx - eye[0]) * t, eye[2] + (tz - eye[2]) * t, width);
    return reduceQuestState(chronicles(), { type: "map", x: hx, y: hy });
  };
  for (const [x, y] of [[0.5, 0.5], [0.4, 0.35], [0.62, 0.86]]) assert.equal(pick(x, y).chronicles.entryId, null, `bare ground at ${x}, ${y}`);
  for (const record of getHotspotRecords()) assert.equal(pick(record.hotspot.x, record.hotspot.y).chronicles.entryId, record.id);
});

test("Back closes an open record first, then the nation, then returns Home", () => {
  let state = reduceQuestState(chronicles(), { type: "record", id: "aethelgard" });
  assert.equal(canUnwind(state.chronicles), true);
  state = reduceQuestState(state, { type: "back" });
  assert.equal(state.screen, "chronicles"); assert.equal(state.chronicles.entryId, null, "the record closes before anything else");
  assert.deepEqual(state.chronicles.focus, { kind: "nation", nation: "aethelgard" });
  state = reduceQuestState(state, { type: "back" });
  assert.equal(state.screen, "chronicles"); assert.deepEqual(state.chronicles.focus, { kind: "overview" });
  assert.equal(canUnwind(state.chronicles), false);
  state = reduceQuestState(state, { type: "back" });
  assert.equal(state.screen, "home"); assert.equal(state.modal, null);
  const laws = apply(chronicles(), { type: "exhibit", exhibit: "laws" }, { type: "record", id: "law-of-the-pawn" }, { type: "back" });
  assert.equal(laws.screen, "chronicles", "an article closes first"); assert.equal(laws.chronicles.collection, "laws");
  assert.equal(reduceQuestState(laws, { type: "back" }).screen, "home", "a collection overview is the last step before Home");
  const reopened = reduceQuestState(apply(laws, { type: "back" }), { type: "home", panel: "chronicles" });
  assert.deepEqual(reopened.chronicles, createChroniclesScene(), "the Home tile reopens the Atlas with a fresh archive state");
});

test("close-record closes only an open record and never unwinds the nation", () => {
  const focused = apply(chronicles(), { type: "record", id: "solforiz" }, { type: "close-record" });
  assert.equal(focused.chronicles.entryId, null); assert.deepEqual(focused.chronicles.focus, { kind: "nation", nation: "solforiz" });
  assert.equal(reduceQuestState(focused, { type: "close-record" }), focused, "with nothing open it changes nothing");
});

test("pause and resume keep the Chronicles collection and open record", () => {
  const original = apply(chronicles(), { type: "exhibit", exhibit: "interregnum" }, { type: "record", id: "year-19" });
  let state = reduceQuestState({ ...original, entered: true }, { type: "pause", reason: "Hands out of view" });
  assert.equal(state.screen, "pause"); assert.equal(state.previousScreen, "chronicles");
  for (const event of [
    { type: "back" }, { type: "exhibit", exhibit: "laws" }, { type: "record", id: "year-0" }, { type: "close-record" },
    { type: "map", x: 0.15, y: 0.17 }, { type: "focus", focus: { kind: "overview" } },
  ] satisfies QuestEvent[]) {
    assert.equal(reduceQuestState(state, event), state, `${event.type} waits for Resume`);
  }
  state = reduceQuestState(state, { type: "resume" });
  assert.equal(state.screen, "chronicles"); assert.equal(state.chronicles.collection, "interregnum"); assert.equal(state.chronicles.entryId, "year-19");
  assert.equal(state.chronicles, original.chronicles, "the scene state survives pause untouched");
  const home = apply(state, { type: "pause", reason: "Break" }, { type: "pause-home" });
  assert.equal(home.screen, "home");
});

test("the archive's load report lands while paused over Chronicles, moves forward only, and is ignored elsewhere", () => {
  const paused = reduceQuestState({ ...chronicles(), entered: true }, { type: "pause", reason: "Your headset paused the visit." });
  const ready = reduceQuestState(paused, { type: "loaded", result: "ready" });
  assert.equal(ready.chronicles.load, "ready", "a room that finishes building during a pause reports it");
  assert.equal(ready.screen, "pause"); assert.equal(ready.paused, true);
  assert.equal(reduceQuestState(ready, { type: "loaded", result: "ready" }), ready, "a repeated report is a no-op");
  assert.equal(reduceQuestState(ready, { type: "resume" }).chronicles.load, "ready");
  const flat = reduceQuestState(reduceQuestState(ready, { type: "resume" }), { type: "loaded", result: "flat" });
  assert.equal(flat.chronicles.load, "flat");
  const pausedHome = reduceQuestState({ ...createQuestState(), entered: true }, { type: "pause", reason: "Break" });
  assert.equal(reduceQuestState(pausedHome, { type: "loaded", result: "ready" }), pausedHome, "a pause over another screen ignores it");
});

test("the shared parity fixture replays identically through the Quest events", () => {
  // Each shared event goes through the Quest event that carries it on Quest.
  const quest = (event: ChroniclesSceneEvent): QuestEvent => {
    switch (event.type) {
      case "collection": return { type: "exhibit", exhibit: event.collection };
      case "entry": return { type: "record", id: event.id };
      case "map": return { type: "map", x: event.x, y: event.y };
      case "focus": return { type: "focus", focus: event.focus };
      case "loaded": return { type: "loaded", result: event.result };
      case "back": return { type: "back" };
    }
  };
  let state = chronicles();
  assert.deepEqual(state.chronicles, CHRONICLES_SCENE_FIXTURE.start);
  for (const [index, step] of CHRONICLES_SCENE_FIXTURE.steps.entries()) {
    const label = `step ${index + 1}: ${step.note}`;
    const before = state;
    state = reduceQuestState(state, quest(step.event));
    if (step.unchanged && step.event.type === "back" && !canUnwind(before.chronicles)) {
      // Back with nothing left to close: the shared state stays and Quest returns Home.
      assert.equal(state.screen, "home", label); assert.equal(state.chronicles, before.chronicles, label);
      continue;
    }
    assert.equal(state.screen, "chronicles", label);
    assert.deepEqual(state.chronicles, step.expect, label);
    assert.equal(canUnwind(state.chronicles), step.canUnwind, label);
    if (step.unchanged) assert.equal(state, before, `${label} keeps the same QuestState`);
    else assert.notEqual(state, before, label);
  }
  assert.equal(state.screen, "home", "the fixture ends where Back returns Home");
});

test("Chronicles copy renders exactly on Quest except its dashes, which the shared adaptation maps", () => {
  // UIKitML builds each @font-face Barlow atlas with UIKit's default TTF charset.
  const atlas = new Set(" \tABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?.,;:'\"()-[]{}@#$%&*+=/\\<>");
  const copy = [CHRONICLES_TITLE, ...CHRONICLE_EXHIBITS.map(item => item.title), ...Object.values(CHRONICLE_LABELS).flatMap(item => [item.name, item.meaning]), ...CHRONICLE_RECORDS.flatMap(item => [item.title, item.body])];
  for (const value of copy) {
    for (const glyph of questText(value)) assert.ok(atlas.has(glyph), `${JSON.stringify(glyph)} in ${value}`);
    assert.equal(questText(value), value.replace(/[–—]/gu, "-"), "only dashes change; quotes and apostrophes stay exact");
  }
});

test("the Chronicles control surface: body text at 1 degree or more, targets at their menu size or larger, the monument clear", () => {
  // Computed from the blueprint vantages, as the runtime places the panel.
  const peak = buildReliefMesh(ARCHIVE_BLUEPRINT.monument.quest.reliefWidth, 64).maxHeight;
  for (const posture of ["seated", "standing"] as const) {
    for (const textScale of [100, 125, 150] as const) {
      const label = `${posture} at ${textScale}%`, pose = chroniclesPanelPose(posture, textScale);
      const menuTarget = panelDegrees(QUEST_UI_LAYOUT.minimumHitSize, QUEST_UI_LAYOUT.authoredScale * textScale / 100, DEFAULT_QUEST_PREFERENCES.panelDistance);
      assert.ok(panelDegrees(CHRONICLES_PANEL.bodyUnits, pose.scale, pose.distance) >= CHRONICLES_PANEL.bodyDegrees - 1e-9, `${label}: 16-unit body text`);
      assert.ok(panelDegrees(CHRONICLES_PANEL.recordBodyUnits, pose.scale, pose.distance) >= CHRONICLES_PANEL.bodyDegrees, `${label}: the record body`);
      assert.ok(panelDegrees(QUEST_UI_LAYOUT.minimumHitSize, pose.scale, pose.distance) >= menuTarget - 1e-9, `${label}: targets keep at least the menu's angular size`);
      const check = controlSurfaceCheck(posture, textScale, peak);
      assert.ok(check.upright >= 1 && check.tilted >= 1, `${label}: the drawn view clears the monument by ${check.upright.toFixed(2)} and ${check.tilted.toFixed(2)} degrees`);
      // The lift is close to the least that clears: 3 cm less overlaps or comes within a degree.
      const lift = CHRONICLES_PANEL_LIFT[posture][textScale];
      if (lift >= 0.03) {
        const lower = controlSurfaceCheck(posture, textScale, peak, lift - 0.03);
        assert.ok(lower.upright < 1 || lower.tilted < 1, `${label}: the lift is no larger than it needs to be`);
      }
      const bearing = Math.atan2(pose.position[0], -pose.position[2]) * 180 / Math.PI;
      assert.ok(Math.abs(bearing) <= 60, `${label}: the panel centre stays inside the comfort cone`);
      assert.ok(pose.distance > 0.9 && pose.distance < 1.1, `${label}: the panel stays at the blueprint's arm's-length distance`);
    }
  }
  // The blueprint's own 0.86 m surface would show 16-unit text at about 0.6 degrees, which is why the panel grows.
  const surface = ARCHIVE_BLUEPRINT.viewpoints.quest[0].controlSurface;
  assert.ok(panelDegrees(16, surface.width / 12.8, chroniclesPanelPose("seated", 100).distance) < 0.7);
});
