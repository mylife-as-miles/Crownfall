// Chronicles contracts contain no browser, renderer, or framework dependencies.
import type { CanonStatus } from "./status";

export type ChronicleExhibitId = "atlas" | "interregnum" | "laws";
/**
 * The archive's collections: the three approved exhibits and the Contested
 * Record, which stays dormant while it has no visible entries.
 */
export type ChronicleCollectionId = ChronicleExhibitId | "contested";
export type ChronicleLabel = "recorded" | "disputed" | "testimony" | "rumor";
export type ChronicleNationId = "korvenia" | "solforiz" | "aethelgard" | "kwind-09";

/** Fractions of the map image's width and height, each from 0 to 1. */
export interface ChronicleHotspot {
  x: number;
  y: number;
}

export interface ChronicleRecord {
  id: string;
  exhibit: ChronicleExhibitId;
  nation?: ChronicleNationId;
  label: ChronicleLabel;
  hotspot?: ChronicleHotspot;
  title: string;
  body: string;
}

export interface ChronicleExhibit {
  id: ChronicleExhibitId;
  title: string;
}

export interface ChronicleLabelInfo {
  name: string;
  meaning: string;
}

export interface ChroniclesMap {
  src: string;
  width: number;
  height: number;
  alt: string;
}

/**
 * One piece of archive text as both platforms show it, read from the registry.
 * `canonStatus` records who approved the words and `label` how far the world
 * trusts them; neither decides the other.
 */
export interface ChronicleEntry {
  /** Kebab-case, unique across the approved and proposal layers. */
  readonly id: string;
  readonly collection: ChronicleCollectionId;
  readonly canonStatus: CanonStatus;
  /** In-world reliability; absent for non-diegetic exhibit captions. */
  readonly label?: ChronicleLabel;
  readonly title: string;
  readonly body: string;
  readonly nation?: ChronicleNationId;
  readonly eventId?: string;
  readonly sourceIds?: readonly string[];
}

/**
 * Where the archive looks inside the active collection: its overview, or one
 * nation of the Atlas. Later collections add their own kinds.
 */
export type ChroniclesFocus =
  | { readonly kind: "overview" }
  | { readonly kind: "nation"; readonly nation: ChronicleNationId };

/** How the archive is presented: still building, in 3D, as the flat painting, or not at all. */
export type ChroniclesLoad = "loading" | "ready" | "flat" | "failed";

/** The scene state both platforms reduce through scene-state.ts. */
export interface ChroniclesSceneState {
  readonly collection: ChronicleCollectionId;
  readonly focus: ChroniclesFocus;
  /** The registry entry open in the record panel. */
  readonly entryId: string | null;
  readonly load: ChroniclesLoad;
}

export type ChroniclesSceneEvent =
  | { readonly type: "collection"; readonly collection: ChronicleCollectionId }
  | { readonly type: "focus"; readonly focus: ChroniclesFocus }
  | { readonly type: "entry"; readonly id: string }
  /** A point on the painted map in image fractions, as hotspots are placed. */
  | { readonly type: "map"; readonly x: number; readonly y: number }
  | { readonly type: "loaded"; readonly result: Exclude<ChroniclesLoad, "loading"> }
  | { readonly type: "back" };
