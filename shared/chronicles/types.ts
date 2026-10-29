// Chronicles contracts contain no browser, renderer, or framework dependencies.
export type ChronicleExhibitId = "atlas" | "interregnum" | "laws";
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
