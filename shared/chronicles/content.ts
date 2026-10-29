import type { Direction } from "../menu/types";
import type {
  ChronicleExhibit, ChronicleExhibitId, ChronicleHotspot, ChronicleLabel,
  ChronicleLabelInfo, ChronicleNationId, ChronicleRecord, ChroniclesMap,
} from "./types";

// Creator-approved archive copy. Desktop and Quest render these strings exactly;
// do not edit or extend them without the creator's approval.
export const CHRONICLES_TITLE = "Chronicles";

export const CHRONICLE_EXHIBITS: readonly ChronicleExhibit[] = [
  { id: "atlas", title: "The Atlas" },
  { id: "interregnum", title: "The Interregnum" },
  { id: "laws", title: "The Laws of the Gambit" },
];

export const CHRONICLE_LABELS: Record<ChronicleLabel, ChronicleLabelInfo> = {
  recorded: { name: "Recorded", meaning: "Accepted by all four nations" },
  disputed: { name: "Disputed", meaning: "Nations or houses tell it differently" },
  testimony: { name: "Testimony", meaning: "One named source's account" },
  rumor: { name: "Rumor", meaning: "Unverified talk" },
};

export const CHRONICLES_MAP: ChroniclesMap = {
  src: "/assets/chronicles/chronicles-map.webp",
  width: 2048,
  height: 1529,
  alt: "Painted map of Korvenia, Aethelgard, Kwind-09 and Solforiz",
};

export const CHRONICLE_RECORDS: readonly ChronicleRecord[] = [
  {
    id: "korvenia",
    exhibit: "atlas",
    nation: "korvenia",
    label: "recorded",
    hotspot: { x: 0.15, y: 0.17 },
    title: "Korvenia — The Grand Duchy",
    body: "A duchy of masks and bells beneath a violet eclipse. Its ruler is the Veiled Archduke, a title passed by inheritance. True names are guarded; ward-bells ring against what the eclipse lets in. Its court speaks High Korvenic; its streets, Vesper-Cant. Its Gambit is called Le Jeu des Rois Morts, the Game of Dead Kings.",
  },
  {
    id: "solforiz",
    exhibit: "atlas",
    nation: "solforiz",
    label: "recorded",
    hotspot: { x: 0.78, y: 0.68 },
    title: "Solforiz — The Scorched Caliphate",
    body: "A sulfur desert where an inland sea once boiled. Its Ignition Imams keep the faith and the engines alike. Its navigators see four seconds ahead; anything further is Mirage. Its tongue is Kharzani. Its Gambit is the Qimar al-Malik.",
  },
  {
    id: "aethelgard",
    exhibit: "atlas",
    nation: "aethelgard",
    label: "recorded",
    hotspot: { x: 0.83, y: 0.2 },
    title: "Aethelgard — The Blood-Throne",
    body: "Seven Great Houses share a Blood-Throne, and their riders are bound to the First-Born, beasts as old as the mountains. Its people speak Old Aethel; its riders command in High Drakonic. Its Gambit is the Cyning-Slieht.",
  },
  {
    id: "kwind-09",
    exhibit: "atlas",
    nation: "kwind-09",
    label: "recorded",
    hotspot: { x: 0.16, y: 0.62 },
    title: "Kwind-09 — The Kwind Zaibatsu",
    body: "A vertical city governed by the Board. Wealth lives Cloud-side; labor lives Sump-side, where workers are entries in a ledger. The \"09\" is Foundry Sector 09, now sealed behind Aether fog. Its people speak Kwind-Pidgin. Its Gambit runs as Protocol K-GAMBIT.09.",
  },
  {
    id: "year-0",
    exhibit: "interregnum",
    label: "recorded",
    title: "Year 0 — The Crownfall",
    body: "The High Sovereign's Sovereign Crown, an astral engine, tore itself apart. The calendar begins with the fall.",
  },
  {
    id: "years-1-12",
    exhibit: "interregnum",
    label: "recorded",
    title: "Years 1–12 — The Scavenger Wars",
    body: "The four powers fought over the Crown-Shards the blast left behind.",
  },
  {
    id: "year-19",
    exhibit: "interregnum",
    label: "recorded",
    title: "Year 19 — The Concord of Cinders",
    body: "An uneasy armistice signed at Vane, a spire on the borders where the four powers meet.",
  },
  {
    id: "year-33",
    exhibit: "interregnum",
    label: "recorded",
    title: "Year 33 — Now",
    body: "The shards grow unstable, the truce is failing, and a generation has grown up with no memory of the old order.",
  },
  {
    id: "why-representatives",
    exhibit: "laws",
    label: "recorded",
    title: "Why representatives",
    body: "When a claim cannot be settled, nations do not march armies. Each sends sixteen living representatives to the board, and the outcome decides the claim: land, passage, custody, even sovereignty. What follows the judgment is politics.",
  },
  {
    id: "the-muster",
    exhibit: "laws",
    label: "recorded",
    title: "The muster",
    body: "A nation's sixteen are drawn from its banners. Great houses send their champions; minor houses send their levies, and levies stand in the front rank.",
  },
  {
    id: "law-of-the-pawn",
    exhibit: "laws",
    label: "recorded",
    title: "The law of the pawn",
    body: "A pawn may become anything but a king.",
  },
];

type HotspotRecord = ChronicleRecord & { nation: ChronicleNationId; hotspot: ChronicleHotspot };

const recordsOf = (exhibit: ChronicleExhibitId) => CHRONICLE_RECORDS.filter((record) => record.exhibit === exhibit);
const exhibitRecords: Record<ChronicleExhibitId, readonly ChronicleRecord[]> = {
  atlas: recordsOf("atlas"), interregnum: recordsOf("interregnum"), laws: recordsOf("laws"),
};
const hotspotRecords = CHRONICLE_RECORDS.filter((record): record is HotspotRecord =>
  record.exhibit === "atlas" && !!record.nation && !!record.hotspot);

/** One exhibit's records in content order, as a shared array. */
export function getChronicleRecords(exhibit: ChronicleExhibitId): readonly ChronicleRecord[] {
  return exhibitRecords[exhibit] || [];
}

export function getChronicleRecord(id: string): ChronicleRecord | undefined {
  return CHRONICLE_RECORDS.find((record) => record.id === id);
}

/** A title's text before its em dash, such as a nation or a timeline stop's years; otherwise the whole title. */
export function getChronicleShortTitle(record: ChronicleRecord): string {
  return record.title.split(" — ")[0];
}

/** The nation records placed on the map, in content order. getNextHotspot indexes this list. */
export function getHotspotRecords(): readonly HotspotRecord[] {
  return hotspotRecords;
}

/** A nation's approved records other than its map record, in content order. */
export function getNationAccounts(nation: ChronicleNationId): readonly ChronicleRecord[] {
  return CHRONICLE_RECORDS.filter((record) => record.nation === nation && !record.hotspot);
}

// x and y are image fractions; radius is a fraction of the image width, so the
// hit area stays round on the wider-than-tall map. The default is the smallest
// Quest ring, 6% of the image width across. Empty ground returns null.
export function hotspotAt(x: number, y: number, radius = 0.03): ChronicleRecord | null {
  const aspect = CHRONICLES_MAP.height / CHRONICLES_MAP.width;
  let found: ChronicleRecord | null = null;
  let nearest = Infinity;
  for (const record of hotspotRecords) {
    const distance = Math.hypot(record.hotspot.x - x, (record.hotspot.y - y) * aspect);
    if (distance <= radius && distance < nearest) {
      found = record;
      nearest = distance;
    }
  }
  return found;
}

// Hotspots move spatially: to the nearest one within 45 degrees of the pressed
// direction, measured in image pixels and preferring straight lines. With none
// that way the selection stays, as the Home and Chapter grids clamp.
export function getNextHotspot(current: number, direction: Direction): number {
  const index = clampIndex(current, hotspotRecords.length);
  const from = hotspotRecords[index].hotspot;
  let next = index;
  let best = Infinity;
  hotspotRecords.forEach(({ hotspot }, candidate) => {
    const dx = (hotspot.x - from.x) * CHRONICLES_MAP.width;
    const dy = (hotspot.y - from.y) * CHRONICLES_MAP.height;
    const along = direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
    const across = Math.abs(direction === "left" || direction === "right" ? dy : dx);
    if (along > 0 && across <= along && along + 2 * across < best) {
      best = along + 2 * across;
      next = candidate;
    }
  });
  return next;
}

// Timeline stops and articles follow the Showcase list rule: left or up steps
// back, right or down steps forward, and both ends clamp rather than wrap.
export function getNextTimelineStop(current: number, direction: Direction): number {
  return step(exhibitRecords.interregnum.length, current, direction);
}

export function getNextArticle(current: number, direction: Direction): number {
  return step(exhibitRecords.laws.length, current, direction);
}

function step(count: number, current: number, direction: Direction): number {
  return clampIndex(clampIndex(current, count) + (direction === "left" || direction === "up" ? -1 : 1), count);
}

function clampIndex(index: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Number.isFinite(index) ? Math.trunc(index) : 0));
}
