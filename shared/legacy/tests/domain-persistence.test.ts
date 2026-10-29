import assert from "node:assert/strict";
import test from "node:test";
import { LEGACY_COPY } from "../content/copy";
import { defaultHeraldry } from "../content/heraldry";
import { buildLegacyPreview, getLegacyPreviewRecords } from "../domain/fixtures";
import { openChallenge } from "../domain/notices";
import {
  LEGACY_STORAGE_KEY, clearLegacy, loadLegacy, parseLegacySave, readSearchParam, resolveLegacySession, saveLegacy,
  serializeLegacy, validateLegacySave,
} from "../domain/persistence";
import type { LegacyMigration, LegacyStorageLike } from "../domain/persistence";
import { reduceLegacy } from "../domain/reducer";
import { createLegacyState } from "../domain/state";
import type { LegacyState } from "../types";

const AT = "2026-02-01T10:00:00.000Z";

class MemoryStorage implements LegacyStorageLike {
  readonly items = new Map<string, string>();
  readonly log: string[] = [];
  failWrites = false;
  failReads = false;
  getItem(key: string): string | null {
    this.log.push(`get:${key}`);
    if (this.failReads) throw new Error("storage blocked");
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.log.push(`set:${key}`);
    if (this.failWrites) throw new Error("quota exceeded");
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.log.push(`remove:${key}`);
    this.items.delete(key);
  }
  writes(): string[] {
    return this.log.filter((entry) => !entry.startsWith("get:"));
  }
}

/** Fails the test on any access at all: proves a code path never touches storage. */
const POISONED: LegacyStorageLike = {
  getItem: () => assert.fail("storage was read"),
  setItem: () => assert.fail("storage was written"),
  removeItem: () => assert.fail("storage was cleared"),
};

function founded(): LegacyState {
  let state = createLegacyState({ at: AT });
  for (const event of [
    { type: "found-banner", name: "House Ashgrove", nationId: "solforiz", heraldry: defaultHeraldry("solforiz"), motto: "Shade for all", at: AT, seed: 11 },
    { type: "nominate", memberId: "member-2", file: "g", at: AT },
  ] as const) {
    const transition = reduceLegacy(state, event);
    assert.equal(transition.error, null);
    state = transition.state;
  }
  return state;
}

function storedWith(value: unknown): MemoryStorage {
  const storage = new MemoryStorage();
  storage.items.set(LEGACY_STORAGE_KEY, typeof value === "string" ? value : JSON.stringify(value));
  return storage;
}

function mutated(state: LegacyState, edit: (draft: Record<string, unknown>) => void): Record<string, unknown> {
  const draft = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
  edit(draft);
  return draft;
}

function assertUntouched(storage: MemoryStorage, raw: string): void {
  assert.deepEqual(storage.writes(), [], "no writes or removals");
  assert.equal(storage.items.get(LEGACY_STORAGE_KEY), raw, "stored bytes unchanged");
}

test("a production banner round-trips through storage under the documented key", () => {
  assert.equal(LEGACY_STORAGE_KEY, "crownfall.legacy.save");
  const state = founded();
  const storage = new MemoryStorage();
  assert.deepEqual(saveLegacy(storage, state), { ok: true });
  const loaded = loadLegacy(storage);
  assert.equal(loaded.status, "loaded");
  assert.deepEqual(loaded.status === "loaded" && loaded.state, state);
  assert.equal(loaded.status === "loaded" && loaded.migratedFrom, null);
  assert.equal(validateLegacySave(createLegacyState()), null);
  assert.deepEqual(loadLegacy(new MemoryStorage()), { status: "empty" });
});

test("a production banner with match history, captives and notices round-trips intact", () => {
  // Replays the "captive" fixture's real records as engine output on a production state.
  let state = createLegacyState({ at: AT });
  const steps = [
    { type: "found-banner", name: "House Vesperine", nationId: "korvenia", heraldry: defaultHeraldry("korvenia"), motto: null, at: "2026-01-12T19:00:00.000Z", seed: 1201 },
    { type: "nominate", memberId: "member-1", file: "b", at: "2026-01-12T19:05:00.000Z" },
  ] as const;
  for (const step of steps) state = reduceLegacy(state, step).state;
  state = reduceLegacy(state, { type: "accept-challenge", noticeId: openChallenge(state)?.id ?? "", at: AT }).state;
  const [fixtureRecord] = getLegacyPreviewRecords("captive");
  const transition = reduceLegacy(state, { type: "record-match", record: { ...fixtureRecord, source: "engine" } });
  assert.equal(transition.error, null);
  const storage = new MemoryStorage();
  assert.deepEqual(saveLegacy(storage, transition.state), { ok: true });
  const loaded = loadLegacy(storage);
  assert.equal(loaded.status, "loaded");
  assert.deepEqual(loaded.status === "loaded" && loaded.state, transition.state);
  assert.equal(transition.state.members[0].status, "captive");
});

test("preview states are never saved and stored preview states are refused", () => {
  const preview = buildLegacyPreview("captive");
  assert.ok(preview);
  const storage = new MemoryStorage();
  const result = saveLegacy(storage, preview);
  assert.equal(result.ok, false);
  assert.deepEqual(storage.log, [], "storage never touched");
  assert.equal(serializeLegacy(preview).ok, false);
  const smuggled = storedWith(preview);
  const raw = smuggled.items.get(LEGACY_STORAGE_KEY) ?? "";
  const loaded = loadLegacy(smuggled);
  assert.equal(loaded.status === "invalid" && loaded.reason, "preview");
  assertUntouched(smuggled, raw);
});

test("invalid JSON, wrong types, dangling references and future versions are refused with storage untouched", () => {
  const state = founded();
  const cases: [string, unknown, RegExp][] = [
    ["invalid JSON", "{not json", /not valid JSON/],
    ["not an object", "[1,2]", /not an object/],
    ["wrong status type", mutated(state, (d) => { (d.members as Record<string, unknown>[])[0].status = "missing"; }), /status/],
    ["negative recognition", mutated(state, (d) => { (d.standing as Record<string, unknown>).recognition = -2; }), /standing/],
    ["bad heraldry", mutated(state, (d) => { ((d.banner as Record<string, unknown>).heraldry as Record<string, unknown>).charge = "comet"; }), /heraldry/],
    ["dangling nomination", mutated(state, (d) => { (d.nomination as Record<string, unknown>).memberId = "member-9"; }), /unknown member/],
    ["dangling aftermath", mutated(state, (d) => { d.pendingAftermath = ["chr-0999"]; }), /pendingAftermath/],
    ["dangling memory", mutated(state, (d) => { (d.relations as Record<string, unknown>[])[1].memory = ["chr-0404"]; }), /memory/],
    ["dangling chronicle match ref", mutated(state, (d) => { ((d.chronicle as Record<string, unknown>[])[1].refs as Record<string, unknown>).matchId = "ghost"; }), /unknown match/],
    ["unknown captor", mutated(state, (d) => { const m = (d.members as Record<string, unknown>[])[0]; m.status = "captive"; m.captiveOf = "house-nowhere"; }), /captiveOf/],
    ["empty captor", mutated(state, (d) => { const m = (d.members as Record<string, unknown>[])[0]; m.status = "captive"; m.captiveOf = ""; }), /captiveOf/],
    ["string counter", mutated(state, (d) => { (d.members as Record<string, unknown>[])[1].captures = "3"; }), /counters/],
    ["fractional disposition", mutated(state, (d) => { (d.relations as Record<string, unknown>[])[0].disposition = -24.5; }), /disposition/],
    ["unknown notice house", mutated(state, (d) => { (d.notices as Record<string, unknown>[])[0].fromHouseId = "crown:atlantis"; }), /fromHouseId/],
    ["preview id in production", mutated(state, (d) => { d.previewId = "captive"; }), /previewId/],
    ["claimed nomination file", mutated(state, (d) => { (d.nomination as Record<string, unknown>).file = "c"; }), /open file/],
    ["processed ids mismatch", mutated(state, (d) => { d.processedMatchIds = ["ghost"]; }), /processedMatchIds/],
    ["chronicle out of sequence", mutated(state, (d) => { (d.chronicle as Record<string, unknown>[])[0].id = "chr-0042"; }), /out of sequence/],
    ["future version", mutated(state, (d) => { d.schemaVersion = 2; }), /schema 2/],
    ["missing version", mutated(state, (d) => { delete d.schemaVersion; }), /schemaVersion/],
  ];
  for (const [label, value, pattern] of cases) {
    const storage = storedWith(value);
    const raw = storage.items.get(LEGACY_STORAGE_KEY) ?? "";
    const loaded = loadLegacy(storage);
    assert.equal(loaded.status, "invalid", label);
    assert.match(loaded.status === "invalid" ? loaded.error : "", pattern, label);
    assertUntouched(storage, raw);
    const session = resolveLegacySession("", storage);
    assert.equal(session.kind, "recovery", label);
    assert.equal(session.state.banner, null);
    assertUntouched(storage, raw);
  }
  const future = loadLegacy(storedWith(mutated(state, (d) => { d.schemaVersion = 3; })));
  assert.equal(future.status === "invalid" && future.reason, "future-version");
});

test("older saves run through injectable migrations; missing or broken migrations are refused", () => {
  const state = founded();
  // A hypothetical schema 0 that stored recognition as "renown".
  const v0 = mutated(state, (d) => {
    d.schemaVersion = 0;
    const standing = d.standing as Record<string, unknown>;
    standing.renown = standing.recognition;
    delete standing.recognition;
  });
  const renown: LegacyMigration = {
    from: 0,
    to: 1,
    migrate: (save) => {
      const standing = { ...(save.standing as Record<string, unknown>) };
      standing.recognition = standing.renown;
      delete standing.renown;
      return { ...save, schemaVersion: 1, standing };
    },
  };
  const migrated = parseLegacySave(JSON.stringify(v0), { migrations: [renown] });
  assert.equal(migrated.ok, true);
  assert.deepEqual(migrated.ok && migrated.state, state);
  assert.equal(migrated.ok && migrated.migratedFrom, 0);
  const noPath = parseLegacySave(JSON.stringify(v0));
  assert.match(noPath.ok ? "" : noPath.error, /No migration exists from schema 0/);
  const throwing = parseLegacySave(JSON.stringify(v0), { migrations: [{ from: 0, to: 1, migrate: () => { throw new Error("boom"); } }] });
  assert.match(throwing.ok ? "" : throwing.error, /failed: boom/);
  const wrongVersion = parseLegacySave(JSON.stringify(v0), { migrations: [{ from: 0, to: 1, migrate: (save) => save }] });
  assert.match(wrongVersion.ok ? "" : wrongVersion.error, /did not produce schema 1/);
  const invalidAfter = parseLegacySave(JSON.stringify(v0), { migrations: [{ from: 0, to: 1, migrate: (save) => ({ ...save, schemaVersion: 1 }) }] });
  assert.match(invalidAfter.ok ? "" : invalidAfter.error, /standing/, "migrated output is still deep-validated");
});

test("saving reports storage failures; clearing removes only the Legacy key", () => {
  const storage = new MemoryStorage();
  storage.failWrites = true;
  const failed = saveLegacy(storage, founded());
  assert.equal(failed.ok, false);
  assert.match(failed.ok ? "" : failed.error, /quota exceeded/);
  const kept = new MemoryStorage();
  kept.items.set("crownfall.quest.preferences", "{}");
  saveLegacy(kept, founded());
  assert.deepEqual(clearLegacy(kept), { ok: true });
  assert.equal(kept.items.has(LEGACY_STORAGE_KEY), false);
  assert.equal(kept.items.get("crownfall.quest.preferences"), "{}");
  const blocked = new MemoryStorage();
  blocked.failReads = true;
  const load = loadLegacy(blocked);
  assert.equal(load.status === "invalid" && load.reason, "unavailable");
  assert.equal(resolveLegacySession("", blocked).kind, "unavailable");
});

test("reset after confirmation clears storage and leaves a fresh, saveable state", () => {
  const storage = new MemoryStorage();
  saveLegacy(storage, founded());
  const reset = reduceLegacy(founded(), { type: "reset", at: "2026-03-01T00:00:00.000Z" });
  assert.equal(reset.error, null);
  clearLegacy(storage);
  assert.deepEqual(loadLegacy(storage), { status: "empty" });
  assert.deepEqual(saveLegacy(storage, reset.state), { ok: true });
  assert.equal(loadLegacy(storage).status, "loaded");
});

test("guest and preview sessions never touch storage", () => {
  const guest = resolveLegacySession("?legacy=fresh", POISONED, { at: AT });
  assert.equal(guest.kind, "guest");
  assert.equal(guest.persistent, false);
  assert.equal(guest.state.banner, null);
  assert.equal(guest.kind === "guest" && guest.label, "Guest session — not saved");
  assert.equal(guest.state.createdAt, AT);
  const preview = resolveLegacySession("?foo=1&legacyPreview=returned", POISONED);
  assert.equal(preview.kind, "preview");
  assert.equal(preview.persistent, false);
  assert.equal(preview.state.mode, "preview");
  assert.equal(preview.kind === "preview" && preview.label, LEGACY_COPY.preview.label);
  assert.equal(preview.kind === "preview" && preview.title, "Captive returned");
  const missing = resolveLegacySession("?legacyPreview=nonsense", POISONED);
  assert.equal(missing.kind, "preview-missing");
  assert.equal(missing.state.mode, "production");
  assert.equal(missing.persistent, false);
  // legacyPreview takes precedence over legacy=fresh; an empty preview id is reported, still without storage.
  assert.equal(resolveLegacySession("?legacy=fresh&legacyPreview=", POISONED).kind, "preview-missing");
});

test("ordinary sessions load, start new or recover", () => {
  const storage = new MemoryStorage();
  assert.equal(resolveLegacySession("", storage).kind, "new");
  saveLegacy(storage, founded());
  const stored = resolveLegacySession("?other=1", storage);
  assert.equal(stored.kind, "stored");
  assert.equal(stored.persistent, true);
  assert.equal(stored.state.banner?.name, "House Ashgrove");
  assert.equal(resolveLegacySession("", null).kind, "unavailable");
  assert.equal(resolveLegacySession("?legacy=stale", storage).kind, "stored");
});

test("query parsing decodes values without DOM APIs", () => {
  assert.equal(readSearchParam("?legacyPreview=allied-loss&x=1", "legacyPreview"), "allied-loss");
  assert.equal(readSearchParam("legacy=fresh", "legacy"), "fresh");
  assert.equal(readSearchParam("?a=%E2%9C%93+b", "a"), "✓ b");
  assert.equal(readSearchParam("?a=%E2%9C", "a"), null);
  assert.equal(readSearchParam("", "a"), null);
  assert.equal(readSearchParam("?flag", "flag"), "");
});
