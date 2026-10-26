import assert from "node:assert/strict";
import test from "node:test";
import { ARENAS, CHAPTERS, SETTINGS_CATEGORIES } from "../../shared/menu/content";
import {
  DEFAULT_QUEST_PREFERENCES, QUEST_PREFERENCES_KEY, QUEST_VISIT_STEPS,
  adjustQuestPreference, createQuestState, getQuestSettingsRows,
  normalizeQuestPreferences, reduceQuestState,
} from "./quest-state";
import type { QuestEvent, QuestState } from "./quest-state";

const apply = (state: QuestState, ...events: QuestEvent[]) => events.reduce(reduceQuestState, state);
const play = () => reduceQuestState(createQuestState(), { type: "nav", screen: "play" });

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
  for (const panel of ["legacy", "chronicles", "herald"] as const) {
    const state = reduceQuestState(createQuestState(), { type: "home", panel });
    assert.equal(state.modal, panel); assert.equal(reduceQuestState(state, { type: "confirm" }).screen, "home");
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
