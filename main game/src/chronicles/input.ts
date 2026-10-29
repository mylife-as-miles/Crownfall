// Pure navigation rules for the Chronicles screen. The scene state itself
// lives in the shared reducer; these decide which event an input sends and
// where the keyboard highlight moves.
import { getHotspotRecords, getNextHotspot } from "../../../shared/chronicles/content";
import type { ChronicleCollectionId, ChroniclesSceneEvent, ChroniclesSceneState } from "../../../shared/chronicles/types";
import type { Direction } from "../settings-types";

const hotspots = getHotspotRecords();

/** LB/RB and Q/E: the next collection in archive order, wrapping at both ends. */
export function cycleCollection(collections: readonly ChronicleCollectionId[], current: ChronicleCollectionId, step: 1 | -1): ChronicleCollectionId {
  if (!collections.length) return current;
  const index = collections.indexOf(current);
  return collections[((index < 0 ? 0 : index + step) % collections.length + collections.length) % collections.length];
}

/** Timeline stops and articles: left or up steps back, right or down steps forward, and both ends clamp. */
export function stepList(count: number, index: number, direction: Direction): number {
  const step = direction === "left" || direction === "up" ? -1 : 1;
  return Math.max(0, Math.min(count - 1, index + step));
}

/** The marker index of a nation's map entry, or -1. */
export function hotspotIndexOf(entryId: string | null): number {
  return entryId === null ? -1 : hotspots.findIndex((record) => record.id === entryId);
}

export interface AtlasMove {
  /** The highlighted marker after the move. */
  cursor: number;
  /** The scene event the move sends, if any. */
  event: ChroniclesSceneEvent | null;
  /** Up from the top row leaves the map for the collection tabs. */
  toTabs: boolean;
}

/**
 * Arrows on the Atlas move spatially between the nations. Over the overview
 * they move the highlight only. While a nation is in focus they carry the focus
 * to the neighbour, and while its entry is open they open the neighbour's
 * entry, so the camera always follows and the open nation is never off screen.
 */
export function moveOnAtlas(state: ChroniclesSceneState, cursor: number, direction: Direction): AtlasMove {
  const from = state.entryId !== null ? Math.max(0, hotspotIndexOf(state.entryId))
    : state.focus.kind === "nation" ? Math.max(0, hotspots.findIndex((record) => state.focus.kind === "nation" && record.nation === state.focus.nation))
      : cursor;
  const next = getNextHotspot(from, direction);
  if (next === from) return { cursor: from, event: null, toTabs: direction === "up" };
  const record = hotspots[next];
  if (state.entryId !== null) return { cursor: next, event: { type: "entry", id: record.id }, toTabs: false };
  if (state.focus.kind === "nation") return { cursor: next, event: { type: "focus", focus: { kind: "nation", nation: record.nation } }, toTabs: false };
  return { cursor: next, event: null, toTabs: false };
}

/** True when a key event belongs to a text field rather than the menu. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable);
}
