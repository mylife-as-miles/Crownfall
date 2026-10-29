// The registry of everything Chronicles may show (docs/chronicles/ARCHITECTURE.md §4.1).
// Approved entries come from content.ts, one per record and with the record's
// own strings. Proposal entries follow them only while the content policy shows
// unapproved words. Screens on both platforms render registry entries only and
// never import proposal modules directly.
import { CHRONICLE_LABELS, CHRONICLE_RECORDS, getHotspotRecords } from "./content";
import { isCanonStatus, isCreatorApproved, isStatusVisible } from "./status";
import type { ContentPolicy } from "./status";
import type { ChronicleCollectionId, ChronicleEntry, ChronicleLabel, ChronicleNationId, ChronicleRecord } from "./types";

/** Every collection in archive order. A collection with no visible entries is dormant. */
export const CHRONICLE_COLLECTIONS: readonly ChronicleCollectionId[] = Object.freeze(["atlas", "interregnum", "laws", "contested"] as const);

export interface ChronicleRegistry {
  /** Every entry, approved first in content order and then proposals in list order, whatever the policy. For audits and checks; screens use entries(). */
  readonly all: readonly ChronicleEntry[];
  /** The entries the policy shows, in the order of `all`. The same array for the same policy. */
  entries(policy: ContentPolicy): readonly ChronicleEntry[];
  /** One entry by id, or undefined when it is unknown or the policy hides it. */
  entry(id: string, policy: ContentPolicy): ChronicleEntry | undefined;
  /** One collection's visible entries, in the order of `all`. */
  collectionEntries(collection: ChronicleCollectionId, policy: ContentPolicy): readonly ChronicleEntry[];
  /** The collections with at least one visible entry, in archive order. */
  collections(policy: ContentPolicy): readonly ChronicleCollectionId[];
}

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LABELS = Object.keys(CHRONICLE_LABELS) as ChronicleLabel[];
const NATIONS: readonly ChronicleNationId[] = getHotspotRecords().map((record) => record.nation);
const EMPTY: readonly ChronicleEntry[] = Object.freeze([]);
const SHOW_ALL: ContentPolicy = Object.freeze({ showUnapproved: true });
const APPROVED_ONLY: ContentPolicy = Object.freeze({ showUnapproved: false });

const isKebab = (value: unknown): boolean => typeof value === "string" && KEBAB.test(value);
const hasText = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0;

/**
 * Why an entry may not join the proposal layer; empty when it may. A proposal
 * is agent-written, so it is a working proposal or a placeholder: a status only
 * the creator grants is refused.
 */
export function validateChronicleProposal(entry: ChronicleEntry): string[] {
  if (!entry || typeof entry !== "object") return ["a proposal must be an entry object"];
  const problems: string[] = [];
  if (!isKebab(entry.id)) problems.push("its id must be kebab-case");
  if (!isCanonStatus(entry.canonStatus)) problems.push("its canon status is unknown");
  else if (isCreatorApproved(entry.canonStatus)) problems.push(`"${entry.canonStatus}" is granted only by the creator`);
  if (CHRONICLE_COLLECTIONS.indexOf(entry.collection) < 0) problems.push("its collection is unknown");
  if (entry.label !== undefined && LABELS.indexOf(entry.label) < 0) problems.push("its label is unknown");
  if (!hasText(entry.title)) problems.push("it needs a title");
  if (!hasText(entry.body)) problems.push("it needs a body");
  if (entry.nation !== undefined && NATIONS.indexOf(entry.nation) < 0) problems.push("its nation is unknown");
  if (entry.eventId !== undefined && !isKebab(entry.eventId)) problems.push("its event id must be kebab-case");
  if (entry.sourceIds !== undefined && !(Array.isArray(entry.sourceIds) && entry.sourceIds.every(isKebab))) {
    problems.push("its source ids must be kebab-case");
  }
  return problems;
}

/** A frozen copy holding only entry fields, with the same strings. */
function freezeEntry(entry: ChronicleEntry): ChronicleEntry {
  return Object.freeze({
    id: entry.id,
    collection: entry.collection,
    canonStatus: entry.canonStatus,
    ...(entry.label !== undefined ? { label: entry.label } : {}),
    title: entry.title,
    body: entry.body,
    ...(entry.nation !== undefined ? { nation: entry.nation } : {}),
    ...(entry.eventId !== undefined ? { eventId: entry.eventId } : {}),
    ...(entry.sourceIds !== undefined ? { sourceIds: Object.freeze(entry.sourceIds.slice()) } : {}),
  });
}

/**
 * Builds a registry from approved records and a proposal list. Each record
 * becomes an approved entry: collection = exhibit, label = record label, and
 * the record's own title and body. Throws when an id repeats, when a proposal
 * would shadow an approved entry, or when a proposal fails validation.
 */
export function createChronicleRegistry(records: readonly ChronicleRecord[], proposals: readonly ChronicleEntry[]): ChronicleRegistry {
  const byId = new Map<string, ChronicleEntry>();
  const approved = records.map((record) => {
    if (!isKebab(record.id)) throw new Error(`Chronicles registry: approved id ${JSON.stringify(record.id)} is not kebab-case`);
    if (byId.has(record.id)) throw new Error(`Chronicles registry: approved id "${record.id}" appears twice`);
    const entry = freezeEntry({
      id: record.id, collection: record.exhibit, canonStatus: "approved", label: record.label,
      title: record.title, body: record.body, nation: record.nation,
    });
    byId.set(entry.id, entry);
    return entry;
  });
  const drafts = proposals.map((proposal) => {
    const problems = validateChronicleProposal(proposal);
    if (problems.length > 0) {
      throw new Error(`Chronicles registry: proposal ${JSON.stringify(proposal && proposal.id)} is refused: ${problems.join("; ")}`);
    }
    const existing = byId.get(proposal.id);
    if (existing) {
      throw new Error(isCreatorApproved(existing.canonStatus)
        ? `Chronicles registry: proposal "${proposal.id}" would shadow an approved entry`
        : `Chronicles registry: proposal id "${proposal.id}" appears twice`);
    }
    const entry = freezeEntry(proposal);
    byId.set(entry.id, entry);
    return entry;
  });
  const all: readonly ChronicleEntry[] = Object.freeze(approved.concat(drafts));

  // Both views are built once, so a policy always returns the same arrays.
  const view = (policy: ContentPolicy) => {
    const entries: readonly ChronicleEntry[] = Object.freeze(all.filter((entry) => isStatusVisible(entry.canonStatus, policy)));
    const byCollection = new Map<ChronicleCollectionId, readonly ChronicleEntry[]>();
    for (const collection of CHRONICLE_COLLECTIONS) {
      byCollection.set(collection, Object.freeze(entries.filter((entry) => entry.collection === collection)));
    }
    const collections: readonly ChronicleCollectionId[] = Object.freeze(
      CHRONICLE_COLLECTIONS.filter((collection) => (byCollection.get(collection) || EMPTY).length > 0));
    return { entries, byCollection, collections };
  };
  const shown = { all: view(SHOW_ALL), approved: view(APPROVED_ONLY) };
  // A missing or malformed policy shows only creator-approved words.
  const pick = (policy: ContentPolicy) => (policy && policy.showUnapproved === true ? shown.all : shown.approved);

  return Object.freeze({
    all,
    entries: (policy: ContentPolicy) => pick(policy).entries,
    entry(id: string, policy: ContentPolicy) {
      const entry = typeof id === "string" ? byId.get(id) : undefined;
      return entry && isStatusVisible(entry.canonStatus, policy) ? entry : undefined;
    },
    collectionEntries: (collection: ChronicleCollectionId, policy: ContentPolicy) => pick(policy).byCollection.get(collection) || EMPTY,
    collections: (policy: ContentPolicy) => pick(policy).collections,
  });
}

// M1 adds no new words (docs/chronicles/WORK_STATUS.md, decision D1), so no
// proposal ships yet. Proposal modules join this list from M2, and each of
// their entries is a working proposal or a placeholder.
const CHRONICLE_PROPOSALS: readonly ChronicleEntry[] = Object.freeze([]);

/** The registry both platforms read: the approved records, then the proposals. */
export const CHRONICLE_REGISTRY: ChronicleRegistry = createChronicleRegistry(CHRONICLE_RECORDS, CHRONICLE_PROPOSALS);

/** Every entry the policy shows, in registry order. */
export function getChronicleEntries(policy: ContentPolicy): readonly ChronicleEntry[] {
  return CHRONICLE_REGISTRY.entries(policy);
}

/** One entry by id, or undefined when it is unknown or the policy hides it. */
export function getChronicleEntry(id: string, policy: ContentPolicy): ChronicleEntry | undefined {
  return CHRONICLE_REGISTRY.entry(id, policy);
}

/** The collections the policy leaves something to show in, in archive order. */
export function getChronicleCollections(policy: ContentPolicy): readonly ChronicleCollectionId[] {
  return CHRONICLE_REGISTRY.collections(policy);
}

/** One collection's visible entries, in registry order. */
export function getCollectionEntries(collection: ChronicleCollectionId, policy: ContentPolicy): readonly ChronicleEntry[] {
  return CHRONICLE_REGISTRY.collectionEntries(collection, policy);
}
