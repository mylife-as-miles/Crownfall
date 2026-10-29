// Persistence for Legacy saves: deep validation, a migration registry,
// load/save/clear through an injected storage, and session resolution for
// guest (?legacy=fresh) and development preview (?legacyPreview=<id>) URLs.
// A refused or unreadable save is never modified or removed here.

import { LEGACY_COPY } from "../content/copy";
import { validateHeraldry } from "../content/heraldry";
import { getAlliedHouse, getRivalHouse } from "../content/houses";
import { eligibleMusterFiles, isFileLetter } from "../content/muster";
import { isNationId } from "../content/nations";
import { chronicleEntryId } from "./chronicle";
import { buildLegacyPreview, listLegacyPreviews } from "./fixtures";
import { validateBannerName, validateMotto } from "./founding";
import { isKnownHouseId } from "./identity";
import { createLegacyState } from "./state";
import { LEGACY_SCHEMA_VERSION } from "../types";
import type { LegacyState } from "../types";

export const LEGACY_STORAGE_KEY = "crownfall.legacy.save";

/** The subset of the Web Storage API persistence needs; inject localStorage or a test double. */
export interface LegacyStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LegacyMigration {
  from: number;
  to: number;
  migrate(save: Record<string, unknown>): Record<string, unknown>;
}

/** Schema 1 is the first persisted Legacy schema, so no migrations exist yet. Append new steps here. */
export const LEGACY_MIGRATIONS: readonly LegacyMigration[] = [];

export interface PersistenceOptions {
  /** Replaces the built-in migration registry (tests, future tools). */
  migrations?: readonly LegacyMigration[];
}

export type LegacyRefusalReason = "corrupt" | "future-version" | "preview" | "unavailable";

export type LegacyParseResult =
  | { ok: true; state: LegacyState; migratedFrom: number | null }
  | { ok: false; reason: LegacyRefusalReason; error: string };

type Json = Record<string, unknown>;

const RANKS = ["minor-banner", "sworn-banner", "landed-house", "great-house"];
const MEMBER_STATUSES = ["available", "injured", "captive"];
const APPOINTMENTS = ["pawn", "knight", "bishop", "rook", "queen"];
const PROMOTIONS = ["n", "b", "r", "q"];
const STAKES = ["classic", "muster"];
const OUTCOMES = ["victory", "defeat", "draw"];
const REASONS = ["checkmate", "stalemate", "resignation", "timeout", "threefold", "insufficient", "fiftymove", "objective", "draw"];
const FATES = ["survived", "captured", "promoted", "captured-after-promotion", "absent"];
const CHRONICLE_KINDS = ["founding", "nomination", "notice", "challenge-accepted", "match", "capture", "captivity", "injury", "recovery", "return", "promotion", "grievance", "allied-reaction"];
const NOTICE_KINDS = ["muster-summons", "rival-challenge", "allied-demand", "rival-vow", "captivity-notice", "return-notice"];
const NOTICE_STATUSES = ["unread", "read", "accepted", "resolved"];
const UNRESOLVED_KINDS = ["captive", "grievance", "allied-accounting", "challenge"];

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isCount(value: unknown, min = 0): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min;
}

function oneOf(list: readonly string[], value: unknown): boolean {
  return typeof value === "string" && list.indexOf(value) !== -1;
}

function uniqueIds(items: readonly Json[], path: string): string | null {
  const seen = new Set<string>();
  for (let index = 0; index < items.length; index++) {
    const id = items[index].id;
    if (!isText(id)) return `${path}[${index}].id is missing.`;
    if (seen.has(id)) return `${path}[${index}].id duplicates ${id}.`;
    seen.add(id);
  }
  return null;
}

function objectArray(value: unknown, path: string): Json[] | string {
  if (!Array.isArray(value)) return `${path} must be an array.`;
  for (let index = 0; index < value.length; index++) if (!isObject(value[index])) return `${path}[${index}] must be an object.`;
  return value as Json[];
}

/**
 * Deep validation of a current-schema save: every field's type and every
 * reference between members, matches, chronicle entries, notices, matters and
 * houses. Returns the first problem found, or null when the save is sound.
 */
export function validateLegacySave(value: unknown): string | null {
  if (!isObject(value)) return "The save is not an object.";
  if (value.schemaVersion !== LEGACY_SCHEMA_VERSION) return `schemaVersion must be ${LEGACY_SCHEMA_VERSION}.`;
  if (value.mode !== "production" && value.mode !== "preview") return "mode is invalid.";
  if (value.mode === "production" ? value.previewId !== null : !isText(value.previewId)) return "previewId does not match the mode.";
  if (!isString(value.createdAt) || !isString(value.updatedAt)) return "createdAt and updatedAt must be text.";

  const standing = value.standing;
  if (!isObject(standing) || !oneOf(RANKS, standing.rank) || !isCount(standing.recognition) || !isCount(standing.representation, 1)) {
    return "standing is invalid.";
  }

  const members = objectArray(value.members, "members");
  if (typeof members === "string") return members;
  const relations = objectArray(value.relations, "relations");
  if (typeof relations === "string") return relations;
  const matches = objectArray(value.matches, "matches");
  if (typeof matches === "string") return matches;
  const chronicle = objectArray(value.chronicle, "chronicle");
  if (typeof chronicle === "string") return chronicle;
  const notices = objectArray(value.notices, "notices");
  if (typeof notices === "string") return notices;
  const unresolved = objectArray(value.unresolved, "unresolved");
  if (typeof unresolved === "string") return unresolved;
  const processed = value.processedMatchIds;
  const pending = value.pendingAftermath;
  if (!Array.isArray(processed) || !processed.every(isText)) return "processedMatchIds must be a list of ids.";
  if (!Array.isArray(pending) || !pending.every(isText)) return "pendingAftermath must be a list of ids.";
  const nomination = value.nomination;
  if (!isObject(nomination)) return "nomination is invalid.";

  const banner = value.banner;
  if (banner === null) {
    const empty = members.length + relations.length + matches.length + chronicle.length + notices.length + unresolved.length + processed.length + pending.length;
    if (empty !== 0 || nomination.memberId !== null || nomination.file !== null) return "A save without a banner must be empty.";
    return null;
  }
  if (!isObject(banner)) return "banner is invalid.";
  if (!isText(banner.id) || !isString(banner.foundedAt)) return "banner.id and banner.foundedAt are required.";
  const name = validateBannerName(banner.name);
  if (name.ok === false || name.name !== banner.name) return "banner.name breaks the naming rule.";
  if (!isNationId(banner.nationId)) return "banner.nationId is unknown.";
  const nationId = banner.nationId;
  if (validateHeraldry(banner.heraldry).ok === false) return "banner.heraldry is invalid.";
  const motto = validateMotto(banner.motto);
  if (motto.ok === false || motto.motto !== banner.motto) return "banner.motto is invalid.";
  if (!isCount(banner.seed) || (banner.seed as number) > 0xffffffff) return "banner.seed must be an unsigned 32-bit integer.";

  // Ids and cross-references.
  for (const [items, path] of [[members, "members"], [chronicle, "chronicle"], [notices, "notices"], [unresolved, "unresolved"]] as const) {
    const problem = uniqueIds(items, path);
    if (problem) return problem;
  }
  const memberIds = new Set(members.map((member) => member.id as string));
  const chronicleIds = new Set(chronicle.map((entry) => entry.id as string));
  const noticeIds = new Set(notices.map((notice) => notice.id as string));
  const matchIds: string[] = [];
  for (let index = 0; index < matches.length; index++) {
    const id = matches[index].matchId;
    if (!isText(id) || matchIds.indexOf(id) !== -1) return `matches[${index}].matchId is missing or duplicated.`;
    matchIds.push(id);
  }
  if (processed.length !== matchIds.length || processed.some((id, index) => id !== matchIds[index])) return "processedMatchIds does not match the recorded matches.";
  const houseRef = (houseId: unknown): boolean => houseId === null || (isString(houseId) && isKnownHouseId(houseId));
  const matchCount = matches.length;

  for (let index = 0; index < members.length; index++) {
    const member = members[index];
    const path = `members[${index}]`;
    if (!isText(member.name) || !isString(member.epithet) || !isString(member.origin)) return `${path} needs a name, epithet and origin.`;
    if (!oneOf(APPOINTMENTS, member.appointment) || !oneOf(MEMBER_STATUSES, member.status)) return `${path} has an invalid appointment or status.`;
    if ((member.status === "captive") !== (member.captiveOf !== null) || !houseRef(member.captiveOf)) return `${path}.captiveOf does not match its status.`;
    if ((member.status === "injured") !== (member.injuredUntilMatch !== null)) return `${path}.injuredUntilMatch does not match its status.`;
    if (member.injuredUntilMatch !== null && (!isCount(member.injuredUntilMatch, 1) || (member.injuredUntilMatch as number) <= matchCount)) {
      return `${path}.injuredUntilMatch is not a future match.`;
    }
    if (!isCount(member.musters) || !isCount(member.captures) || !isCount(member.timesCaptured)) return `${path} has invalid counters.`;
    const promotions = objectArray(member.battlefieldPromotions, `${path}.battlefieldPromotions`);
    if (typeof promotions === "string") return promotions;
    for (const promotion of promotions) {
      if (!isText(promotion.matchId) || matchIds.indexOf(promotion.matchId) === -1 || !oneOf(PROMOTIONS, promotion.to)) {
        return `${path}.battlefieldPromotions references an unknown match or piece.`;
      }
    }
  }

  if (nomination.memberId !== null && (!isText(nomination.memberId) || !memberIds.has(nomination.memberId))) return "nomination.memberId references an unknown member.";
  if (nomination.file !== null && (!isFileLetter(nomination.file) || eligibleMusterFiles(nationId).indexOf(nomination.file) === -1)) return "nomination.file is not an open file.";
  if ((nomination.memberId === null) !== (nomination.file === null)) return "nomination must name both a member and a file, or neither.";

  const expectedHouses = [getAlliedHouse(nationId).id, getRivalHouse(nationId).id];
  if (relations.length !== expectedHouses.length) return "relations must cover the allied and rival houses.";
  for (let index = 0; index < relations.length; index++) {
    const relation = relations[index];
    if (relation.houseId !== expectedHouses[index]) return `relations[${index}] names the wrong house.`;
    const disposition = relation.disposition;
    if (typeof disposition !== "number" || !Number.isInteger(disposition) || disposition < -100 || disposition > 100) return `relations[${index}].disposition is out of range.`;
    if (!isCount(relation.grievances)) return `relations[${index}].grievances is invalid.`;
    const memory = relation.memory;
    if (!Array.isArray(memory) || !memory.every((id) => isText(id) && chronicleIds.has(id))) return `relations[${index}].memory references unknown chronicle entries.`;
  }

  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const path = `matches[${index}]`;
    if (!oneOf(STAKES, match.stakes) || !oneOf(OUTCOMES, match.outcome) || !oneOf(REASONS, match.reason) || !oneOf(FATES, match.representativeFate)) return `${path} has invalid result fields.`;
    if (!isCount(match.plies) || !isCount(match.representativeCaptures) || !isNationId(match.opponentNationId)) return `${path} has invalid counts or opponent.`;
    if (match.representativeId !== null && (!isText(match.representativeId) || !memberIds.has(match.representativeId))) return `${path}.representativeId references an unknown member.`;
    if (match.representativeFile !== null && !isFileLetter(match.representativeFile)) return `${path}.representativeFile is invalid.`;
    if (!houseRef(match.representativeCapturedBy)) return `${path}.representativeCapturedBy references an unknown house.`;
    if (typeof match.alliedRepresentativeLost !== "boolean" || typeof match.rivalRepresentativeCaptured !== "boolean" || !isString(match.completedAt)) return `${path} has invalid flags.`;
  }

  for (let index = 0; index < chronicle.length; index++) {
    const entry = chronicle[index];
    const path = `chronicle[${index}]`;
    if (entry.id !== chronicleEntryId(index + 1)) return `${path}.id is out of sequence.`;
    if (!oneOf(CHRONICLE_KINDS, entry.kind) || !isString(entry.title) || !isString(entry.body) || !isString(entry.at)) return `${path} has invalid fields.`;
    if (entry.prominence !== "major" && entry.prominence !== "minor") return `${path}.prominence is invalid.`;
    if (entry.matchIndex !== null && (!isCount(entry.matchIndex) || (entry.matchIndex as number) >= matchCount)) return `${path}.matchIndex references an unknown match.`;
    const refs = entry.refs;
    if (!isObject(refs)) return `${path}.refs is invalid.`;
    if (refs.memberId !== undefined && (!isText(refs.memberId) || !memberIds.has(refs.memberId))) return `${path}.refs.memberId references an unknown member.`;
    if (refs.houseId !== undefined && !(isText(refs.houseId) && isKnownHouseId(refs.houseId))) return `${path}.refs.houseId references an unknown house.`;
    if (refs.matchId !== undefined && (!isText(refs.matchId) || matchIds.indexOf(refs.matchId) === -1)) return `${path}.refs.matchId references an unknown match.`;
    if (refs.noticeId !== undefined && (!isText(refs.noticeId) || !noticeIds.has(refs.noticeId))) return `${path}.refs.noticeId references an unknown notice.`;
  }

  for (let index = 0; index < notices.length; index++) {
    const notice = notices[index];
    const path = `notices[${index}]`;
    if (!oneOf(NOTICE_KINDS, notice.kind) || !oneOf(NOTICE_STATUSES, notice.status) || !isString(notice.title) || !isString(notice.body)) return `${path} has invalid fields.`;
    if (!isText(notice.fromHouseId) || !isKnownHouseId(notice.fromHouseId)) return `${path}.fromHouseId references an unknown house.`;
    if (notice.stakes !== null && !oneOf(STAKES, notice.stakes)) return `${path}.stakes is invalid.`;
    if (notice.wager !== null && !isText(notice.wager)) return `${path}.wager is invalid.`;
    if (!isCount(notice.createdAtMatch) || (notice.createdAtMatch as number) > matchCount) return `${path}.createdAtMatch references an unknown match.`;
  }

  for (let index = 0; index < unresolved.length; index++) {
    const matter = unresolved[index];
    const path = `unresolved[${index}]`;
    if (!oneOf(UNRESOLVED_KINDS, matter.kind) || !isString(matter.title) || !isString(matter.body)) return `${path} has invalid fields.`;
    if (!houseRef(matter.houseId)) return `${path}.houseId references an unknown house.`;
    if (matter.memberId !== null && (!isText(matter.memberId) || !memberIds.has(matter.memberId))) return `${path}.memberId references an unknown member.`;
    if (!isCount(matter.openedAtMatch) || (matter.openedAtMatch as number) > matchCount) return `${path}.openedAtMatch references an unknown match.`;
  }

  if (pending.length > 2 || new Set(pending).size !== pending.length || !pending.every((id) => chronicleIds.has(id))) return "pendingAftermath references unknown or too many entries.";
  return null;
}

export type LegacyMigrationResult =
  | { ok: true; save: Record<string, unknown>; migratedFrom: number | null }
  | { ok: false; reason: LegacyRefusalReason; error: string };

/** Runs older saves through the registry up to LEGACY_SCHEMA_VERSION. Future versions are refused. */
export function migrateLegacySave(save: Record<string, unknown>, migrations: readonly LegacyMigration[] = LEGACY_MIGRATIONS): LegacyMigrationResult {
  const start = save.schemaVersion;
  if (typeof start !== "number" || !Number.isInteger(start) || start < 0) return { ok: false, reason: "corrupt", error: "The save has no valid schemaVersion." };
  if (start > LEGACY_SCHEMA_VERSION) {
    return { ok: false, reason: "future-version", error: `The save uses schema ${start}; this build reads up to schema ${LEGACY_SCHEMA_VERSION}.` };
  }
  let current = save;
  let version = start;
  while (version < LEGACY_SCHEMA_VERSION) {
    let step: LegacyMigration | null = null;
    for (const migration of migrations) if (migration.from === version) step = migration;
    if (!step || step.to <= step.from) return { ok: false, reason: "corrupt", error: `No migration exists from schema ${version}.` };
    let next: Record<string, unknown>;
    try {
      next = step.migrate(current);
    } catch (error) {
      return { ok: false, reason: "corrupt", error: `Migration from schema ${version} failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (!isObject(next) || next.schemaVersion !== step.to) return { ok: false, reason: "corrupt", error: `Migration from schema ${version} did not produce schema ${step.to}.` };
    current = next;
    version = step.to;
  }
  return { ok: true, save: current, migratedFrom: start === LEGACY_SCHEMA_VERSION ? null : start };
}

/** Parses stored JSON into a production state, migrating and deep-validating it. */
export function parseLegacySave(raw: string, options: PersistenceOptions = {}): LegacyParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "corrupt", error: "The save is not valid JSON." };
  }
  if (!isObject(parsed)) return { ok: false, reason: "corrupt", error: "The save is not an object." };
  const migrated = migrateLegacySave(parsed, options.migrations ?? LEGACY_MIGRATIONS);
  if (migrated.ok === false) return migrated;
  const problem = validateLegacySave(migrated.save);
  if (problem) return { ok: false, reason: "corrupt", error: problem };
  if (migrated.save.mode === "preview") return { ok: false, reason: "preview", error: "Development preview states are never stored." };
  return { ok: true, state: migrated.save as unknown as LegacyState, migratedFrom: migrated.migratedFrom };
}

export type LegacySerializeResult = { ok: true; json: string } | { ok: false; error: string };

/** Serialises a production state after validating it. Preview states are refused. */
export function serializeLegacy(state: LegacyState): LegacySerializeResult {
  if (state.mode !== "production") return { ok: false, error: "Development preview states are never saved." };
  const problem = validateLegacySave(state);
  if (problem) return { ok: false, error: `The state failed validation: ${problem}` };
  return { ok: true, json: JSON.stringify(state) };
}

export type LegacyLoadResult =
  | { status: "empty" }
  | { status: "loaded"; state: LegacyState; migratedFrom: number | null }
  | { status: "invalid"; reason: LegacyRefusalReason; error: string };

/** Reads the save. An invalid save is reported and left exactly as stored. */
export function loadLegacy(storage: LegacyStorageLike, options: PersistenceOptions = {}): LegacyLoadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(LEGACY_STORAGE_KEY);
  } catch (error) {
    return { status: "invalid", reason: "unavailable", error: `Storage could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (raw === null) return { status: "empty" };
  const parsed = parseLegacySave(raw, options);
  if (parsed.ok === false) return { status: "invalid", reason: parsed.reason, error: parsed.error };
  return { status: "loaded", state: parsed.state, migratedFrom: parsed.migratedFrom };
}

export type LegacyWriteResult = { ok: true } | { ok: false; error: string };

export function saveLegacy(storage: LegacyStorageLike, state: LegacyState): LegacyWriteResult {
  const serialized = serializeLegacy(state);
  if (serialized.ok === false) return serialized;
  try {
    storage.setItem(LEGACY_STORAGE_KEY, serialized.json);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `${LEGACY_COPY.saveFailed} ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Removes the save. Callers confirm with the player first (LEGACY_COPY.reset / newBanner). */
export function clearLegacy(storage: LegacyStorageLike): LegacyWriteResult {
  try {
    storage.removeItem(LEGACY_STORAGE_KEY);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `The save could not be removed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export type LegacySession =
  /** ?legacy=fresh: an in-memory banner that never reads or writes storage. */
  | { kind: "guest"; persistent: false; state: LegacyState; label: string }
  /** ?legacyPreview=<id>: a fixture state, never saved. */
  | { kind: "preview"; persistent: false; previewId: string; title: string; description: string; state: LegacyState; label: string }
  /** ?legacyPreview=<unknown>: an empty guest state with the error to show. Storage is untouched. */
  | { kind: "preview-missing"; persistent: false; previewId: string; error: string; state: LegacyState; label: string }
  /** No storage available: progress lasts for this visit only. */
  | { kind: "unavailable"; persistent: false; state: LegacyState; error: string }
  | { kind: "stored"; persistent: true; state: LegacyState; migratedFrom: number | null }
  | { kind: "new"; persistent: true; state: LegacyState }
  /** The stored save was refused and left untouched; the UI offers a new banner or a guest session. */
  | { kind: "recovery"; persistent: true; state: LegacyState; reason: LegacyRefusalReason; error: string };

export interface LegacySessionOptions extends PersistenceOptions {
  /** createdAt for fresh states; defaults to LEGACY_EPOCH. Founding stamps the real time. */
  at?: string;
}

/** Reads one query parameter from a location.search string without DOM APIs. */
export function readSearchParam(search: string, key: string): string | null {
  const query = search.charAt(0) === "?" ? search.slice(1) : search;
  if (query.length === 0) return null;
  for (const part of query.split("&")) {
    const eq = part.indexOf("=");
    const rawKey = eq === -1 ? part : part.slice(0, eq);
    const rawValue = eq === -1 ? "" : part.slice(eq + 1);
    let name: string;
    let value: string;
    try {
      name = decodeURIComponent(rawKey.replace(/\+/g, " "));
      value = decodeURIComponent(rawValue.replace(/\+/g, " "));
    } catch {
      continue;
    }
    if (name === key) return value;
  }
  return null;
}

/**
 * Decides where this visit's Legacy state comes from. Preview and guest URLs
 * never touch storage; otherwise the stored save is loaded, an empty store
 * starts a new banner, and an unreadable save is reported without changes.
 */
export function resolveLegacySession(search: string, storage: LegacyStorageLike | null, options: LegacySessionOptions = {}): LegacySession {
  const at = options.at;
  const previewId = readSearchParam(search, "legacyPreview");
  if (previewId !== null) {
    const state = buildLegacyPreview(previewId);
    if (state) {
      let title = previewId;
      let description = "";
      for (const listing of listLegacyPreviews()) {
        if (listing.id === previewId) {
          title = listing.title;
          description = listing.description;
        }
      }
      return { kind: "preview", persistent: false, previewId, title, description, state, label: LEGACY_COPY.preview.label };
    }
    return {
      kind: "preview-missing",
      persistent: false,
      previewId,
      error: LEGACY_COPY.preview.missing(previewId),
      state: createLegacyState({ at }),
      label: LEGACY_COPY.guest.label,
    };
  }
  if (readSearchParam(search, "legacy") === "fresh") {
    return { kind: "guest", persistent: false, state: createLegacyState({ at }), label: LEGACY_COPY.guest.label };
  }
  if (!storage) {
    return { kind: "unavailable", persistent: false, state: createLegacyState({ at }), error: LEGACY_COPY.storageUnavailable.body };
  }
  const loaded = loadLegacy(storage, options);
  if (loaded.status === "loaded") return { kind: "stored", persistent: true, state: loaded.state, migratedFrom: loaded.migratedFrom };
  if (loaded.status === "empty") return { kind: "new", persistent: true, state: createLegacyState({ at }) };
  if (loaded.reason === "unavailable") return { kind: "unavailable", persistent: false, state: createLegacyState({ at }), error: loaded.error };
  return { kind: "recovery", persistent: true, state: createLegacyState({ at }), reason: loaded.reason, error: loaded.error };
}
