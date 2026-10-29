// Heraldic vocabulary, per-nation defaults, curated presets, structural
// validation and a rule-of-tincture advisory. Colours always come from
// TINCTURE_SRGB in the environment contract; this module never restates them.

import { TINCTURE_SRGB } from "../environment-contract";
import type { HeraldicCharge, HeraldicDivision, HeraldicOrdinary, Heraldry, NationId, Tincture } from "../types";

export type TinctureClass = "metal" | "colour";

export interface TinctureInfo {
  id: Tincture;
  /** Heraldic name as shown in pickers. */
  label: string;
  /** Plain-language colour for accessibility and tooltips. */
  plain: string;
  class: TinctureClass;
  /** sRGB hex from TINCTURE_SRGB. */
  hex: string;
}

export const TINCTURES: readonly Tincture[] = [
  "or", "argent", "gules", "azure", "vert", "purpure", "sable", "sanguine", "tenne", "celeste",
];
export const DIVISIONS: readonly HeraldicDivision[] = [
  "plain", "per-pale", "per-fess", "per-bend", "per-chevron", "quarterly", "per-saltire",
];
export const ORDINARIES: readonly HeraldicOrdinary[] = [
  "none", "chief", "fess", "pale", "bend", "chevron", "cross", "saltire", "bordure",
];
export const CHARGES: readonly HeraldicCharge[] = [
  "none", "crown", "tower", "key", "sword", "sun", "eclipse", "mullet", "cog", "flame", "tree", "pawn",
];

const TINCTURE_NAMES: Readonly<Record<Tincture, { label: string; plain: string; class: TinctureClass }>> = {
  or: { label: "Or", plain: "gold", class: "metal" },
  argent: { label: "Argent", plain: "silver", class: "metal" },
  gules: { label: "Gules", plain: "red", class: "colour" },
  azure: { label: "Azure", plain: "blue", class: "colour" },
  vert: { label: "Vert", plain: "green", class: "colour" },
  purpure: { label: "Purpure", plain: "purple", class: "colour" },
  sable: { label: "Sable", plain: "black", class: "colour" },
  // Sanguine and tenné are heraldic stains; the rule of tincture treats them as colours.
  sanguine: { label: "Sanguine", plain: "blood red", class: "colour" },
  tenne: { label: "Tenné", plain: "tawny orange", class: "colour" },
  celeste: { label: "Celeste", plain: "sky blue", class: "colour" },
};

export function tinctureInfo(id: Tincture): TinctureInfo {
  const names = TINCTURE_NAMES[id];
  return { id, label: names.label, plain: names.plain, class: names.class, hex: TINCTURE_SRGB[id] };
}

export function tinctureClass(id: Tincture): TinctureClass {
  return TINCTURE_NAMES[id].class;
}

export function tinctureLabel(id: Tincture): string {
  return TINCTURE_NAMES[id].label;
}

export const DIVISION_LABELS: Readonly<Record<HeraldicDivision, string>> = {
  plain: "Plain field",
  "per-pale": "Per pale (halved upright)",
  "per-fess": "Per fess (halved across)",
  "per-bend": "Per bend (halved on the diagonal)",
  "per-chevron": "Per chevron",
  quarterly: "Quarterly",
  "per-saltire": "Per saltire",
};

export const ORDINARY_LABELS: Readonly<Record<HeraldicOrdinary, string>> = {
  none: "No ordinary",
  chief: "Chief",
  fess: "Fess",
  pale: "Pale",
  bend: "Bend",
  chevron: "Chevron",
  cross: "Cross",
  saltire: "Saltire",
  bordure: "Bordure",
};

export const CHARGE_LABELS: Readonly<Record<HeraldicCharge, string>> = {
  none: "No charge",
  crown: "Crown",
  tower: "Tower",
  key: "Key",
  sword: "Sword",
  sun: "Sun in splendour",
  eclipse: "Eclipse",
  mullet: "Mullet (star)",
  cog: "Cog",
  flame: "Flame",
  tree: "Tree",
  pawn: "Pawn",
};

export interface HeraldryPreset {
  id: string;
  label: string;
  /** One line of flavour for preset chips and their accessible description. */
  note: string;
  heraldry: Heraldry;
}

function arms(
  division: HeraldicDivision,
  field: readonly [Tincture, Tincture],
  ordinary: HeraldicOrdinary,
  ordinaryTincture: Tincture,
  charge: HeraldicCharge,
  chargeTincture: Tincture,
): Heraldry {
  return { division, field, ordinary, ordinaryTincture, charge, chargeTincture };
}

/**
 * Curated, rule-of-tincture-compliant presets (working placeholders). The
 * first preset of each nation is its founding default.
 */
export const HERALDRY_PRESETS: Readonly<Record<NationId, readonly HeraldryPreset[]>> = {
  korvenia: [
    { id: "eclipse-vigil", label: "Eclipse Vigil", note: "A golden eclipse kept on a field of night.",
      heraldry: arms("plain", ["sable", "sable"], "none", "or", "eclipse", "or") },
    { id: "veiled-key", label: "Veiled Key", note: "A silver key for the doors the Duchy keeps shut.",
      heraldry: arms("per-bend", ["purpure", "sable"], "none", "argent", "key", "argent") },
    { id: "watch-tower", label: "Watch Tower", note: "A golden tower beneath a silver chief.",
      heraldry: arms("plain", ["purpure", "purpure"], "chief", "argent", "tower", "or") },
    { id: "omen-star", label: "Omen Star", note: "A silver star of omen within a golden border.",
      heraldry: arms("per-pale", ["sable", "purpure"], "bordure", "or", "mullet", "argent") },
  ],
  solforiz: [
    { id: "sulfur-sun", label: "Sulfur Sun", note: "The sun in splendour over tawny stone.",
      heraldry: arms("plain", ["tenne", "tenne"], "none", "or", "sun", "or") },
    { id: "furnace-gate", label: "Furnace Gate", note: "A silver gate tower beneath a golden chief.",
      heraldry: arms("plain", ["gules", "gules"], "chief", "or", "tower", "argent") },
    { id: "deep-well", label: "Deep Well", note: "A flame kept above the deep water.",
      heraldry: arms("plain", ["azure", "azure"], "fess", "or", "flame", "gules") },
    { id: "walled-court", label: "Walled Court", note: "A red sun within the court wall.",
      heraldry: arms("plain", ["or", "or"], "bordure", "gules", "sun", "gules") },
  ],
  aethelgard: [
    { id: "ancestral-oak", label: "Ancestral Oak", note: "The ancestral tree between blood and night.",
      heraldry: arms("per-fess", ["sanguine", "sable"], "none", "or", "tree", "or") },
    { id: "cairn-blade", label: "Cairn Blade", note: "A sword raised over a silver chevron.",
      heraldry: arms("plain", ["vert", "vert"], "chevron", "argent", "sword", "or") },
    { id: "blood-crown", label: "Blood Crown", note: "A crown of deep red within a black border.",
      heraldry: arms("plain", ["argent", "argent"], "bordure", "sable", "crown", "sanguine") },
    { id: "hearth-flame", label: "Hearth Flame", note: "The winter fire that keeps a clan together.",
      heraldry: arms("quarterly", ["sanguine", "vert"], "none", "or", "flame", "or") },
  ],
  "kwind-09": [
    { id: "signal-cog", label: "Signal Cog", note: "A silver cog across a diagonal of night and steel.",
      heraldry: arms("per-bend", ["sable", "azure"], "none", "argent", "cog", "argent") },
    { id: "exchange-key", label: "Exchange Key", note: "A black key set on a silver pale.",
      heraldry: arms("plain", ["azure", "azure"], "pale", "argent", "key", "sable") },
    { id: "crossed-lines", label: "Crossed Lines", note: "A working cog where the lines cross.",
      heraldry: arms("plain", ["celeste", "celeste"], "saltire", "argent", "cog", "sable") },
    { id: "seated-pawn", label: "Seated Pawn", note: "A golden pawn that holds its seat.",
      heraldry: arms("plain", ["sable", "sable"], "bordure", "argent", "pawn", "or") },
  ],
};

/** Looks a preset up by nation and id. */
export function findHeraldryPreset(nationId: NationId, presetId: string): HeraldryPreset | null {
  for (const preset of HERALDRY_PRESETS[nationId]) if (preset.id === presetId) return preset;
  return null;
}

/** The heraldry a founding ceremony starts from for each nation. */
export function defaultHeraldry(nationId: NationId): Heraldry {
  return cloneHeraldry(HERALDRY_PRESETS[nationId][0].heraldry);
}

export function cloneHeraldry(heraldry: Heraldry): Heraldry {
  return {
    division: heraldry.division,
    field: [heraldry.field[0], heraldry.field[1]],
    ordinary: heraldry.ordinary,
    ordinaryTincture: heraldry.ordinaryTincture,
    charge: heraldry.charge,
    chargeTincture: heraldry.chargeTincture,
  };
}

export function heraldryEquals(a: Heraldry, b: Heraldry): boolean {
  return a.division === b.division && a.field[0] === b.field[0] && a.field[1] === b.field[1] &&
    a.ordinary === b.ordinary && a.ordinaryTincture === b.ordinaryTincture &&
    a.charge === b.charge && a.chargeTincture === b.chargeTincture;
}

function isMember<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).indexOf(value) !== -1;
}

export function isTincture(value: unknown): value is Tincture {
  return isMember(TINCTURES, value);
}

export type HeraldryValidation = { ok: true; heraldry: Heraldry } | { ok: false; errors: string[] };

/** Structural validation only. Taste is advisory (see tinctureAdvisory) and never blocks founding. */
export function validateHeraldry(value: unknown): HeraldryValidation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, errors: ["Heraldry must be an object."] };
  }
  const record = value as Record<string, unknown>;
  const errors: string[] = [];
  if (!isMember(DIVISIONS, record.division)) errors.push("Unknown field division.");
  const field = record.field;
  if (!Array.isArray(field) || field.length !== 2 || !isTincture(field[0]) || !isTincture(field[1])) {
    errors.push("The field needs exactly two known tinctures.");
  }
  if (!isMember(ORDINARIES, record.ordinary)) errors.push("Unknown ordinary.");
  if (!isTincture(record.ordinaryTincture)) errors.push("Unknown ordinary tincture.");
  if (!isMember(CHARGES, record.charge)) errors.push("Unknown charge.");
  if (!isTincture(record.chargeTincture)) errors.push("Unknown charge tincture.");
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, heraldry: cloneHeraldry(value as Heraldry) };
}

export function isHeraldry(value: unknown): value is Heraldry {
  return validateHeraldry(value).ok;
}

export type HeraldryAdvisoryCode = "same-tincture" | "metal-on-metal" | "colour-on-colour";

export interface HeraldryAdvisory {
  part: "ordinary" | "charge";
  code: HeraldryAdvisoryCode;
  message: string;
}

/** Ordinaries that carry a centred charge ("on a fess, a key"); with the others the charge sits on the field. */
const CHARGED_ORDINARIES: readonly HeraldicOrdinary[] = ["fess", "pale", "bend", "cross", "saltire"];

/** The tinctures a part is laid upon, deduplicated. */
function fieldTinctures(heraldry: Heraldry): Tincture[] {
  if (heraldry.division === "plain" || heraldry.field[0] === heraldry.field[1]) return [heraldry.field[0]];
  return [heraldry.field[0], heraldry.field[1]];
}

function judge(part: "ordinary" | "charge", tincture: Tincture, grounds: readonly Tincture[], out: HeraldryAdvisory[]): void {
  const partName = part === "ordinary" ? "The ordinary" : "The charge";
  for (const ground of grounds) {
    if (ground === tincture) {
      out.push({ part, code: "same-tincture", message: `${partName} shares the ${tinctureLabel(ground).toLowerCase()} beneath it and will vanish at a distance.` });
      return;
    }
  }
  for (const ground of grounds) {
    if (tinctureClass(ground) !== tinctureClass(tincture)) continue;
    const metal = tinctureClass(tincture) === "metal";
    out.push({
      part,
      code: metal ? "metal-on-metal" : "colour-on-colour",
      message: metal
        ? `${partName} sets metal on metal (${tinctureLabel(tincture)} on ${tinctureLabel(ground)}); heralds would choose a colour for contrast.`
        : `${partName} sets colour on colour (${tinctureLabel(tincture)} on ${tinctureLabel(ground)}); a metal would read more clearly.`,
    });
    return;
  }
}

/**
 * The rule of tincture as advice: metal should lie on colour and colour on
 * metal. Returns warnings for the founding UI; it never refuses a design.
 */
export function tinctureAdvisory(heraldry: Heraldry): HeraldryAdvisory[] {
  const out: HeraldryAdvisory[] = [];
  const field = fieldTinctures(heraldry);
  if (heraldry.ordinary !== "none") judge("ordinary", heraldry.ordinaryTincture, field, out);
  if (heraldry.charge !== "none") {
    const onOrdinary = chargeLiesOnOrdinary(heraldry.ordinary);
    judge("charge", heraldry.chargeTincture, onOrdinary ? [heraldry.ordinaryTincture] : field, out);
  }
  return out;
}

/** A readable blazon, e.g. "Per bend purpure and sable, a key argent" or "Azure, on a fess or a flame gules". */
export function describeHeraldry(heraldry: Heraldry): string {
  const lower = (t: Tincture) => tinctureLabel(t).toLowerCase();
  const field = heraldry.division === "plain"
    ? capitalise(lower(heraldry.field[0]))
    : `${capitalise(DIVISION_BLAZON[heraldry.division])} ${lower(heraldry.field[0])} and ${lower(heraldry.field[1])}`;
  const chargeName = heraldry.charge === "sun" ? "sun in splendour" : heraldry.charge;
  const charge = heraldry.charge === "none" ? "" : `${/^[aeiou]/.test(chargeName) ? "an" : "a"} ${chargeName} ${lower(heraldry.chargeTincture)}`;
  if (heraldry.ordinary === "none") return charge ? `${field}, ${charge}` : field;
  const ordinary = `${heraldry.ordinary} ${lower(heraldry.ordinaryTincture)}`;
  if (!charge) return `${field}, a ${ordinary}`;
  if (chargeLiesOnOrdinary(heraldry.ordinary)) return `${field}, on a ${ordinary} ${charge}`;
  return `${field}, a ${ordinary}, ${charge}`;
}

const DIVISION_BLAZON: Readonly<Record<HeraldicDivision, string>> = {
  plain: "plain",
  "per-pale": "per pale",
  "per-fess": "per fess",
  "per-bend": "per bend",
  "per-chevron": "per chevron",
  quarterly: "quarterly",
  "per-saltire": "per saltire",
};

function capitalise(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/** Whether a centred charge is laid on this ordinary (advisory and renderer agree on it). */
export function chargeLiesOnOrdinary(ordinary: HeraldicOrdinary): boolean {
  return CHARGED_ORDINARIES.indexOf(ordinary) !== -1;
}

/** Whether the charge breaks the rule of tincture and should be fimbriated (outlined) for legibility. */
export function chargeNeedsFimbriation(heraldry: Heraldry): boolean {
  if (heraldry.charge === "none") return false;
  for (const advice of tinctureAdvisory(heraldry)) if (advice.part === "charge") return true;
  return false;
}
