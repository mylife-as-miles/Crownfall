import { CHRONICLES_MAP, getHotspotRecords, hotspotAt } from "../content";
import type { ChronicleHotspot, ChronicleNationId, ChronicleRecord } from "../types";

// The Atlas relief: one deterministic heightfield that desktop and Quest both
// sculpt, so the 3D map has the same geography on each. Positions are image
// fractions like hotspots (x from the left edge, y down from the top edge).
// Sizes and elevations are in map widths, so each platform scales by its own
// width. In relief space the painting lies on the XZ plane centred on the
// origin, north toward -Z and east toward +X, and y = 0 is the sea surface.
// Nothing here draws: the painting stays the albedo and the landforms only
// lift what it already shows.

type Point = readonly [x: number, y: number];
type CrestPoint = readonly [x: number, y: number, rise: number];
/** Half-extents in map widths: east and west, toward the north edge, toward the south edge. */
type Reach = readonly [across: number, north: number, south: number];

export type ReliefFill = "water" | "lava";
export type ReliefQuality = "quest" | "low" | "medium" | "high";

// Painted forms are seen from the south, so a summit's flanks reach further
// south across its painted face than north behind it. `crag` roughens a form
// by up to that fraction of its rise; `fill` marks water or lava for living details.
export type ReliefLandform =
  // A summit with straight flanks; `at` is the painted summit.
  | { id: string; kind: "peak"; at: Point; reach: Reach; rise: number; crag?: number }
  // A rounded rise.
  | { id: string; kind: "hill"; at: Point; reach: Reach; rise: number }
  // A flat-topped terrace; `edge` is the share of its reach given to the slope, and `box` squares it.
  | { id: string; kind: "mesa"; at: Point; reach: Reach; rise: number; edge: number; box?: boolean }
  // A mesa raised after the sea is cut: built ground standing in the water.
  | { id: string; kind: "quay"; at: Point; reach: Reach; rise: number; edge: number; box?: boolean }
  // A crest line with a rise at each point.
  | { id: string; kind: "ridge"; crest: readonly CrestPoint[]; reach: Reach; crag?: number }
  // A volcano; `crater` is the crater's radius in map widths.
  | { id: string; kind: "cone"; at: Point; reach: Reach; rise: number; crater: number; craterDepth: number; fill?: ReliefFill }
  // A shallow hollow.
  | { id: string; kind: "basin"; at: Point; radius: number; depth: number; fill?: ReliefFill }
  // A bed carved along a path; `width` is its half-width.
  | { id: string; kind: "channel"; path: readonly Point[]; width: number; depth: number; fill?: ReliefFill }
  // Water inside a closed coast, falling to the seabed across `shelf`.
  | { id: string; kind: "sea"; coast: readonly Point[]; shelf: number }
  // Flat, dry ground under painted lettering: `reach` runs along and across
  // the text, and `angle` turns it clockwise from east in degrees.
  | { id: string; kind: "plate"; at: Point; reach: readonly [along: number, across: number]; angle: number };

type Landform<Kind extends ReliefLandform["kind"]> = Extract<ReliefLandform, { kind: Kind }>;

/** The painting's depth per unit of width; relief depth is width times this. */
export const RELIEF_ASPECT = CHRONICLES_MAP.height / CHRONICLES_MAP.width;

/** Elevations in map widths. The sea surface is 0; label plates and carved beds stay at or above `dry`. */
export const RELIEF_LEVELS = { seabed: -0.012, lowland: 0.006, rim: 0.006, dry: 0.002 } as const;

/** The carved slab in map widths: the flat rim band and its blend, the edge chamfer and the underside. */
export const RELIEF_SLAB = { rimFlat: 0.01, rimBlend: 0.012, chamfer: 0.004, base: -0.05 } as const;

/** Cells across the map per quality; rows follow the painting's aspect. */
export const RELIEF_SEGMENTS: Readonly<Record<ReliefQuality, number>> = { quest: 176, low: 192, medium: 384, high: 448 };

// Placed against the painting at 2048 x 1529. Groups run north-west, the
// centre, north-east, south-east and south-west, then the label plates.
export const RELIEF_LANDFORMS: readonly ReliefLandform[] = [
  // Korvenia: a cliffed highland under the ducal city with the eclipse court
  // on its crown, a crag behind, and the falls of the River of Dead Kings.
  { id: "korvenia-highland", kind: "mesa", at: [0.18, 0.27], reach: [0.17, 0.14, 0.17], rise: 0.034, edge: 0.55 },
  { id: "eclipse-court", kind: "mesa", at: [0.19, 0.19], reach: [0.08, 0.045, 0.07], rise: 0.05, edge: 0.35 },
  { id: "korvenia-plaza", kind: "mesa", at: [0.2, 0.305], reach: [0.09, 0.03, 0.06], rise: 0.042, edge: 0.35 },
  { id: "korvenia-crag", kind: "peak", at: [0.215, 0.07], reach: [0.03, 0.015, 0.05], rise: 0.062, crag: 0.1 },
  { id: "falls-crest", kind: "ridge", crest: [[0.235, 0.02, 0.052], [0.3, 0.025, 0.06], [0.365, 0.035, 0.058], [0.41, 0.07, 0.048]], reach: [0.035, 0.02, 0.045], crag: 0.08 },
  { id: "chapel-knoll", kind: "hill", at: [0.065, 0.36], reach: [0.04, 0.03, 0.04], rise: 0.034 },
  { id: "falls-pool", kind: "basin", at: [0.345, 0.15], radius: 0.025, depth: 0.004, fill: "water" },
  { id: "river-of-dead-kings", kind: "channel", path: [[0.345, 0.155], [0.335, 0.185], [0.355, 0.205], [0.375, 0.235], [0.39, 0.27], [0.4, 0.31], [0.408, 0.35], [0.41, 0.39], [0.405, 0.415], [0.42, 0.44], [0.44, 0.475], [0.445, 0.515], [0.43, 0.555], [0.418, 0.585], [0.405, 0.615]], width: 0.012, depth: 0.006, fill: "water" },

  // The centre: a forested spine and a misted range to the north, then open
  // lowland where the rivers braid toward the Kwind-09 harbour.
  { id: "spine-ridge", kind: "ridge", crest: [[0.445, 0.085, 0.05], [0.458, 0.14, 0.05], [0.468, 0.21, 0.042], [0.476, 0.29, 0.032], [0.486, 0.37, 0.022], [0.492, 0.43, 0.012]], reach: [0.055, 0.03, 0.05], crag: 0.08 },
  { id: "misted-range", kind: "ridge", crest: [[0.52, 0.06, 0.036], [0.555, 0.12, 0.044], [0.575, 0.2, 0.034], [0.565, 0.29, 0.022]], reach: [0.045, 0.02, 0.045], crag: 0.1 },
  { id: "lowland-tor", kind: "peak", at: [0.476, 0.545], reach: [0.025, 0.01, 0.035], rise: 0.022 },
  { id: "east-tor", kind: "peak", at: [0.567, 0.44], reach: [0.02, 0.01, 0.03], rise: 0.02 },
  { id: "border-hills", kind: "ridge", crest: [[0.44, 0.66, 0.016], [0.5, 0.645, 0.022], [0.53, 0.655, 0.02], [0.56, 0.66, 0.016]], reach: [0.02, 0.012, 0.03], crag: 0.2 },
  { id: "west-stream", kind: "channel", path: [[0.3, 0.45], [0.345, 0.47], [0.35, 0.52], [0.375, 0.565], [0.39, 0.6]], width: 0.006, depth: 0.0025, fill: "water" },
  { id: "spine-stream", kind: "channel", path: [[0.452, 0.47], [0.465, 0.525], [0.47, 0.555], [0.44, 0.59], [0.415, 0.605]], width: 0.006, depth: 0.0025, fill: "water" },
  { id: "delta-west", kind: "channel", path: [[0.405, 0.615], [0.37, 0.63], [0.33, 0.645], [0.3, 0.66]], width: 0.006, depth: 0.0025, fill: "water" },
  { id: "delta-south", kind: "channel", path: [[0.405, 0.615], [0.39, 0.65], [0.375, 0.68], [0.365, 0.7]], width: 0.006, depth: 0.0025, fill: "water" },
  { id: "highland-river", kind: "channel", path: [[0.555, 0.355], [0.56, 0.4], [0.553, 0.43], [0.545, 0.46], [0.55, 0.5], [0.556, 0.55], [0.566, 0.58], [0.578, 0.605]], width: 0.008, depth: 0.003, fill: "water" },
  { id: "highland-stream", kind: "channel", path: [[0.63, 0.4], [0.615, 0.43], [0.645, 0.46], [0.64, 0.49], [0.668, 0.5]], width: 0.006, depth: 0.0025, fill: "water" },

  // Aethelgard: jagged peaks and the dragon peak along the north edge, the
  // citadel on its rock, the west keep across a gorge, and a walled
  // escarpment dropping into the mist.
  { id: "aethelgard-highland", kind: "mesa", at: [0.8, 0.22], reach: [0.22, 0.17, 0.17], rise: 0.03, edge: 0.5 },
  { id: "citadel-rock", kind: "mesa", at: [0.81, 0.255], reach: [0.07, 0.07, 0.08], rise: 0.046, edge: 0.25 },
  { id: "west-keep", kind: "mesa", at: [0.635, 0.205], reach: [0.032, 0.015, 0.035], rise: 0.05, edge: 0.3 },
  { id: "burning-fort", kind: "mesa", at: [0.618, 0.27], reach: [0.025, 0.012, 0.03], rise: 0.034, edge: 0.3 },
  { id: "aethelgard-range", kind: "ridge", crest: [[0.575, 0.17, 0.034], [0.625, 0.13, 0.05], [0.68, 0.15, 0.04], [0.735, 0.105, 0.052], [0.8, 0.08, 0.056], [0.86, 0.07, 0.06], [0.905, 0.05, 0.064], [0.955, 0.16, 0.046], [0.99, 0.24, 0.034]], reach: [0.04, 0.02, 0.06], crag: 0.12 },
  { id: "west-snow-peak", kind: "peak", at: [0.625, 0.125], reach: [0.055, 0.02, 0.07], rise: 0.068, crag: 0.1 },
  { id: "high-snow-peak", kind: "peak", at: [0.735, 0.1], reach: [0.05, 0.02, 0.065], rise: 0.07, crag: 0.1 },
  { id: "twin-peak", kind: "peak", at: [0.765, 0.085], reach: [0.035, 0.015, 0.06], rise: 0.066, crag: 0.1 },
  { id: "dark-spire", kind: "peak", at: [0.8, 0.075], reach: [0.035, 0.015, 0.07], rise: 0.074, crag: 0.1 },
  { id: "dragon-peak", kind: "peak", at: [0.903, 0.04], reach: [0.085, 0.025, 0.13], rise: 0.086, crag: 0.12 },
  { id: "east-snow-peak", kind: "peak", at: [0.955, 0.155], reach: [0.045, 0.02, 0.06], rise: 0.06, crag: 0.1 },
  { id: "wall-terrace", kind: "mesa", at: [0.87, 0.37], reach: [0.17, 0.03, 0.05], rise: 0.032, edge: 0.4 },
  { id: "aethelgard-foothills", kind: "ridge", crest: [[0.575, 0.3, 0.028], [0.6, 0.38, 0.024], [0.625, 0.45, 0.016]], reach: [0.03, 0.015, 0.03], crag: 0.15 },
  { id: "aethelgard-gorge", kind: "channel", path: [[0.668, 0.165], [0.684, 0.22], [0.7, 0.28], [0.702, 0.35], [0.69, 0.42]], width: 0.018, depth: 0.018, fill: "water" },

  // Solforiz: a scorched tableland with smoking cones, a broken crater, crags
  // split by lava to the south-west, and lava pools around the ziggurat's dais.
  { id: "scorched-tableland", kind: "mesa", at: [0.76, 0.76], reach: [0.24, 0.12, 0.2], rise: 0.009, edge: 0.6 },
  { id: "ember-cone", kind: "cone", at: [0.688, 0.528], reach: [0.05, 0.02, 0.065], rise: 0.044, crater: 0.008, craterDepth: 0.012, fill: "lava" },
  { id: "great-cone", kind: "cone", at: [0.92, 0.625], reach: [0.085, 0.035, 0.13], rise: 0.08, crater: 0.013, craterDepth: 0.022, fill: "lava" },
  { id: "south-cone", kind: "cone", at: [0.645, 0.922], reach: [0.07, 0.02, 0.06], rise: 0.038, crater: 0.007, craterDepth: 0.01, fill: "lava" },
  { id: "broken-crater", kind: "cone", at: [0.6, 0.678], reach: [0.04, 0.015, 0.04], rise: 0.026, crater: 0.012, craterDepth: 0.014, fill: "lava" },
  { id: "scorch-ridge", kind: "ridge", crest: [[0.785, 0.55, 0.026], [0.83, 0.56, 0.03], [0.86, 0.6, 0.026]], reach: [0.03, 0.012, 0.035], crag: 0.15 },
  { id: "rift-crags", kind: "ridge", crest: [[0.565, 0.8, 0.02], [0.587, 0.86, 0.036], [0.6, 0.92, 0.03], [0.595, 0.98, 0.02]], reach: [0.035, 0.015, 0.04], crag: 0.25 },
  { id: "rift-spire", kind: "peak", at: [0.587, 0.857], reach: [0.02, 0.008, 0.035], rise: 0.044, crag: 0.15 },
  { id: "lava-rift", kind: "channel", path: [[0.565, 0.82], [0.56, 0.87], [0.555, 0.93], [0.56, 0.99]], width: 0.008, depth: 0.01, fill: "lava" },
  { id: "lava-rift-east", kind: "channel", path: [[0.592, 0.815], [0.596, 0.85], [0.6, 0.875]], width: 0.006, depth: 0.006, fill: "lava" },
  { id: "ziggurat-dais", kind: "mesa", at: [0.76, 0.66], reach: [0.06, 0.025, 0.045], rise: 0.014, edge: 0.3 },
  { id: "black-fortress", kind: "mesa", at: [0.67, 0.89], reach: [0.05, 0.025, 0.035], rise: 0.016, edge: 0.3 },
  { id: "small-ziggurat", kind: "mesa", at: [0.86, 0.81], reach: [0.025, 0.012, 0.02], rise: 0.013, edge: 0.3 },
  { id: "lava-pool-west", kind: "basin", at: [0.668, 0.79], radius: 0.026, depth: 0.004, fill: "lava" },
  { id: "lava-pool-north", kind: "basin", at: [0.78, 0.732], radius: 0.024, depth: 0.004, fill: "lava" },
  { id: "lava-pool-small", kind: "basin", at: [0.712, 0.743], radius: 0.012, depth: 0.003, fill: "lava" },
  { id: "lava-pool-south", kind: "basin", at: [0.765, 0.842], radius: 0.03, depth: 0.004, fill: "lava" },
  { id: "lava-pool-flow", kind: "basin", at: [0.81, 0.857], radius: 0.018, depth: 0.003, fill: "lava" },
  { id: "caliphate-sea", kind: "sea", coast: [[0.79, 1.05], [0.835, 0.99], [0.87, 0.955], [0.895, 0.915], [0.925, 0.89], [0.96, 0.873], [1.05, 0.85], [1.05, 1.05]], shelf: 0.02 },

  // Kwind-09: the harbour around a raised quay, stacked terraces climbing to
  // the tower, low piers, and a coastal range between the inlet and the rift.
  { id: "kwind-harbour", kind: "sea", coast: [[-0.05, 0.63], [0.03, 0.635], [0.2, 0.665], [0.33, 0.685], [0.38, 0.69], [0.41, 0.7], [0.426, 0.73], [0.433, 0.78], [0.433, 0.85], [0.438, 0.9], [0.455, 0.96], [0.48, 1.05], [-0.05, 1.05]], shelf: 0.02 },
  { id: "kwind-quay", kind: "quay", at: [0.215, 0.755], reach: [0.2, 0.1, 0.11], rise: 0.012, edge: 0.12, box: true },
  { id: "kwind-stack", kind: "quay", at: [0.16, 0.66], reach: [0.11, 0.05, 0.06], rise: 0.018, edge: 0.2, box: true },
  { id: "kwind-tower", kind: "quay", at: [0.157, 0.6], reach: [0.045, 0.03, 0.04], rise: 0.024, edge: 0.25, box: true },
  { id: "kwind-piers", kind: "quay", at: [0.36, 0.865], reach: [0.065, 0.025, 0.03], rise: 0.003, edge: 0.2, box: true },
  { id: "kwind-coast-range", kind: "ridge", crest: [[0.47, 0.55, 0.018], [0.48, 0.64, 0.026], [0.475, 0.72, 0.026], [0.47, 0.8, 0.024], [0.48, 0.88, 0.026], [0.475, 0.96, 0.018]], reach: [0.045, 0.02, 0.035], crag: 0.25 },

  // Painted lettering and the eclipse disc stay flat. Each plate holds its
  // lettering inside the flat part of its reach.
  { id: "korvenia-label", kind: "plate", at: [0.0975, 0.1235], reach: [0.069, 0.019], angle: 0 },
  { id: "eclipse-disc", kind: "plate", at: [0.093, 0.066], reach: [0.06, 0.06], angle: 0 },
  { id: "aethelgard-label", kind: "plate", at: [0.8665, 0.1645], reach: [0.088, 0.021], angle: 0 },
  { id: "river-label", kind: "plate", at: [0.405, 0.3325], reach: [0.059, 0.013], angle: 75.7 },
  { id: "kwind-label", kind: "plate", at: [0.064, 0.5915], reach: [0.067, 0.022], angle: 0 },
  { id: "sump-label", kind: "plate", at: [0.1425, 0.928], reach: [0.065, 0.017], angle: 0 },
  { id: "solforiz-label", kind: "plate", at: [0.788, 0.776], reach: [0.065, 0.023], angle: 0 },
  { id: "caliphate-label", kind: "plate", at: [0.84, 0.9075], reach: [0.145, 0.024], angle: 0 },
];

// Landforms apply in stages: land, carving, sea, built ground, label plates,
// and finally the slab's rim. Each compiles to one flat numeric shape with
// image-fraction bounds, so a sample only visits the forms that can touch it.
const KIND = { peak: 0, hill: 1, mesa: 2, quay: 3, ridge: 4, cone: 5, basin: 6, channel: 7, sea: 8, plate: 9 } as const;
const STAGE = [0, 0, 0, 3, 0, 0, 1, 1, 2, 4];
const BLEND = 0.006;
const LOWLAND_SWELL = 0.0018;
// Peaks, hills, terraces and ridges wobble their reach with noise at their
// own scale, so outlines wander like ground; summits and crests stay put.
const WOBBLE = 0.22;
const WOBBLY = [true, true, true, false, true, false, false, false, false, false];

interface CompiledForm {
  kind: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** The anchor: x as an image fraction, y in map widths from the north edge. */
  ax: number;
  ay: number;
  across: number;
  north: number;
  south: number;
  rise: number;
  edge: number;
  box: boolean;
  crag: number;
  /** A crater or hollow's radius, a channel's half-width or a coast's shelf, in map widths. */
  radius: number;
  depth: number;
  /** A plate's reach along and across its lettering, and its turn. */
  along: number;
  aside: number;
  cos: number;
  sin: number;
  /** Path or coast points as x and y pairs in map widths; a ridge adds each point's rise. */
  points: Float64Array;
  /** A plate's flattened elevation. */
  level: number;
  /** Outline noise frequency, scaled to the form's size. */
  grain: number;
}

// Set by crestDistance: the crest's rise at its nearest point.
let crestRise = 0;
// Set by clip in intersectRelief.
let clipNear = 0;
let clipFar = 0;
const scratch: [number, number] = [0, 0];

// Sixteen unit gradients for the seeded noise below.
const GRADIENTS = Float64Array.from({ length: 32 }, (_, index) =>
  index % 2 ? Math.sin(((index >> 1) * Math.PI) / 8) : Math.cos(((index >> 1) * Math.PI) / 8));

const compiled: readonly CompiledForm[] = RELIEF_LANDFORMS.map(compile).sort((a, b) => STAGE[a.kind] - STAGE[b.kind]);
for (const entry of compiled) {
  if (entry.kind === KIND.plate) entry.level = Math.max(RELIEF_LEVELS.dry, elevate(entry.ax, entry.ay / RELIEF_ASPECT, compiled, compiled.length, false));
}

// The highest the surface can reach, for framing before any mesh exists.
const PEAK_BOUND = RELIEF_LEVELS.lowland + LOWLAND_SWELL * 1.5 + BLEND / 4 + Math.max(...RELIEF_LANDFORMS.map((form) =>
  form.kind === "ridge" ? Math.max(...form.crest.map((point) => point[2])) * (1 + (form.crag || 0))
    : form.kind === "peak" ? form.rise * (1 + (form.crag || 0)) : "rise" in form ? form.rise : 0));

function compile(form: ReliefLandform): CompiledForm {
  const entry: CompiledForm = {
    kind: KIND[form.kind], x0: 0, x1: 0, y0: 0, y1: 0, ax: 0, ay: 0, across: 0, north: 0, south: 0,
    rise: 0, edge: 0, box: false, crag: 0, radius: 0, depth: 0, along: 0, aside: 0, cos: 1, sin: 0, points: new Float64Array(0), level: 0, grain: 0,
  };
  const flat = (points: readonly (Point | CrestPoint)[]) =>
    Float64Array.from(points.flatMap((point) => point.length === 3 ? [point[0], point[1] * RELIEF_ASPECT, point[2]] : [point[0], point[1] * RELIEF_ASPECT]));
  if ("at" in form) [entry.ax, entry.ay] = [form.at[0], form.at[1] * RELIEF_ASPECT];
  if ("reach" in form && form.kind !== "plate") [entry.across, entry.north, entry.south] = form.reach;
  if ("rise" in form) entry.rise = form.rise;
  if ("crag" in form) entry.crag = form.crag || 0;
  if (form.kind === "mesa" || form.kind === "quay") [entry.edge, entry.box] = [form.edge, !!form.box];
  else if (form.kind === "cone") [entry.radius, entry.depth] = [form.crater, form.craterDepth];
  else if (form.kind === "basin") [entry.radius, entry.depth, entry.across, entry.north, entry.south] = [form.radius, form.depth, form.radius, form.radius, form.radius];
  else if (form.kind === "ridge") entry.points = flat(form.crest);
  else if (form.kind === "channel") [entry.points, entry.radius, entry.depth] = [flat(form.path), form.width, form.depth];
  else if (form.kind === "sea") [entry.points, entry.radius] = [flat(form.coast), form.shelf];
  else if (form.kind === "plate") {
    const extent = Math.hypot(form.reach[0], form.reach[1]);
    [entry.along, entry.aside, entry.across, entry.north, entry.south] = [form.reach[0], form.reach[1], extent, extent, extent];
    [entry.cos, entry.sin] = [Math.cos((form.angle * Math.PI) / 180), Math.sin((form.angle * Math.PI) / 180)];
  }
  if (form.kind === "channel" || form.kind === "sea") [entry.across, entry.north, entry.south] = [entry.radius, entry.radius, entry.radius];
  const stride = form.kind === "ridge" ? 3 : 2;
  const xs: number[] = [], ys: number[] = [];
  if (entry.points.length) for (let index = 0; index < entry.points.length; index += stride) xs.push(entry.points[index]), ys.push(entry.points[index + 1]);
  else xs.push(entry.ax), ys.push(entry.ay);
  const slack = WOBBLY[entry.kind] ? 1 + WOBBLE : 1;
  entry.grain = 2.5 / Math.max(entry.across, entry.north, entry.south);
  entry.x0 = Math.min(...xs) - entry.across * slack;
  entry.x1 = Math.max(...xs) + entry.across * slack;
  entry.y0 = (Math.min(...ys) - entry.north * slack) / RELIEF_ASPECT;
  entry.y1 = (Math.max(...ys) + entry.south * slack) / RELIEF_ASPECT;
  return entry;
}

/**
 * Elevation in map widths at an image-fraction point, identical on every
 * platform. Points beyond the painting clamp to its edge. Allocation free.
 */
export function reliefHeightAt(x: number, y: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return NaN;
  return elevate(Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y)), compiled, compiled.length, true);
}

function elevate(x: number, y: number, forms: readonly CompiledForm[], count: number, finished: boolean): number {
  const py = y * RELIEF_ASPECT;
  let height = RELIEF_LEVELS.lowland + LOWLAND_SWELL * (noise(x * 6, py * 6) + 0.5 * noise(x * 13 + 7.1, py * 13 + 3.7));
  let crag = NaN;
  for (let index = 0; index < count; index++) {
    const form = forms[index];
    if (x < form.x0 || x > form.x1 || y < form.y0 || y > form.y1) continue;
    const dx = x - form.ax, dy = py - form.ay;
    let rise = -Infinity;
    switch (form.kind) {
      case KIND.peak:
      case KIND.hill:
      case KIND.cone: {
        const t = wobbled(form, reachDistance(dx, dy, form, false), x, py);
        if (t >= 1) break;
        if (form.kind === KIND.hill) rise = form.rise * (1 - t * t) * (1 - t * t);
        else if (form.kind === KIND.cone) {
          // The flank falls from a round crater rim at full height to the reach
          // in each direction; the crater is cut inside the rim.
          const r = Math.sqrt(dx * dx + dy * dy), crater = form.radius;
          const s = r > crater ? (t * (r - crater)) / Math.max(1e-9, r - crater * t) : 0;
          const bowl = r < crater ? (1 - (r / crater) ** 2) ** 2 : 0;
          rise = form.rise * (1 - s) * Math.sqrt(1 - s) - form.depth * bowl;
        } else {
          if (form.crag && crag !== crag) crag = cragNoise(x, py);
          rise = form.rise * flank(t) * (form.crag ? 1 + form.crag * crag : 1);
        }
        break;
      }
      case KIND.mesa: {
        const t = wobbled(form, reachDistance(dx, dy, form, form.box), x, py);
        if (t < 1) rise = form.rise * (1 - smoothstep(1 - form.edge, 1, t));
        break;
      }
      case KIND.quay: {
        // Built ground climbs from whatever lies beneath it, seabed included.
        const t = reachDistance(dx, dy, form, form.box);
        if (t < 1) height += (Math.max(height, form.rise) - height) * (1 - smoothstep(1 - form.edge, 1, t));
        break;
      }
      case KIND.ridge: {
        const t = wobbled(form, crestDistance(form, x, py), x, py);
        if (t >= 1) break;
        if (form.crag && crag !== crag) crag = cragNoise(x, py);
        rise = crestRise * flank(t) * (form.crag ? 1 + form.crag * crag : 1);
        break;
      }
      case KIND.basin:
      case KIND.channel: {
        const r = Math.sqrt(form.kind === KIND.basin ? dx * dx + dy * dy : pathDistanceSq(form.points, x, py, form.radius)) / form.radius;
        // Beds stop at dry ground, so only the seas meet the sea surface.
        if (r < 1) height = Math.max(height - form.depth * (1 - r * r) * (1 - r * r), Math.min(height, RELIEF_LEVELS.dry));
        break;
      }
      case KIND.sea: {
        // Starting the shelf just inside the land puts the waterline on the painted coast.
        const water = smoothstep(-0.6 * form.radius, form.radius, coastDistance(form.points, x, py, form.radius));
        height += (RELIEF_LEVELS.seabed - height) * water;
        break;
      }
      case KIND.plate: {
        if (!finished) break;
        const along = (dx * form.cos + dy * form.sin) / form.along;
        const across = (dy * form.cos - dx * form.sin) / form.aside;
        const t = Math.sqrt(Math.sqrt(along * along * along * along + across * across * across * across));
        if (t < 1) height += (form.level - height) * (1 - smoothstep(0.72, 1, t));
        break;
      }
    }
    if (rise > height - BLEND) height = smoothMax(height, rise, BLEND);
  }
  if (!finished) return height;
  const edge = Math.min(x, 1 - x, py, RELIEF_ASPECT - py);
  return RELIEF_LEVELS.rim + (height - RELIEF_LEVELS.rim) * smoothstep(RELIEF_SLAB.rimFlat, RELIEF_SLAB.rimFlat + RELIEF_SLAB.rimBlend, edge);
}

// A distance in reach units, wobbled by the form's outline noise; points the
// largest wobble cannot reach skip the noise.
function wobbled(form: CompiledForm, t: number, x: number, py: number): number {
  if (!WOBBLY[form.kind] || t >= 1 + WOBBLE) return t;
  return t / (1 + WOBBLE * Math.max(-1, Math.min(1, noise(x * form.grain + form.ax * 31, py * form.grain + form.ay * 17))));
}

/** A straight flank with a softened foot: 1 at the summit, 0 at the reach. */
function flank(t: number): number {
  return (t < 0.6 ? 0.8 - t : ((1 - t) * (1 - t)) / 0.8) / 0.8;
}

/** Distance from a form's anchor in units of its reach, so 1 is the foot. */
function reachDistance(dx: number, dy: number, form: CompiledForm, box: boolean): number {
  const across = dx / form.across;
  const along = dy / (dy > 0 ? form.south : form.north);
  const across2 = across * across, along2 = along * along;
  if (!box) return Math.sqrt(across2 + along2);
  const across4 = across2 * across2, along4 = along2 * along2;
  return Math.sqrt(Math.sqrt(Math.sqrt(across4 * across4 + along4 * along4)));
}

function crestDistance(form: CompiledForm, x: number, py: number): number {
  const points = form.points, limit = Math.max(form.across, form.north, form.south);
  let best = Infinity;
  for (let index = 3; index < points.length; index += 3) {
    const ax = points[index - 3], ay = points[index - 2], bx = points[index], by = points[index + 1];
    if (beyond(x, py, ax, ay, bx, by, limit)) continue;
    const along = segmentParameter(x, py, ax, ay, bx, by);
    const t = reachDistance(x - ax - (bx - ax) * along, py - ay - (by - ay) * along, form, false);
    if (t < best) {
      best = t;
      crestRise = points[index - 1] + (points[index + 2] - points[index - 1]) * along;
    }
  }
  return best;
}

// Segments further than `limit` cannot matter, so distances skip them; an
// infinite result means nothing lies within reach.
function pathDistanceSq(points: Float64Array, x: number, py: number, limit: number): number {
  let best = Infinity;
  for (let index = 2; index < points.length; index += 2) {
    const ax = points[index - 2], ay = points[index - 1], bx = points[index], by = points[index + 1];
    if (!beyond(x, py, ax, ay, bx, by, limit)) best = Math.min(best, segmentDistanceSq(x, py, ax, ay, bx, by));
  }
  return best;
}

/** Signed distance to a closed coast in map widths, positive over the water. */
function coastDistance(points: Float64Array, x: number, py: number, limit: number): number {
  let inside = false;
  let best = Infinity;
  for (let index = 0, previous = points.length - 2; index < points.length; previous = index, index += 2) {
    const ax = points[previous], ay = points[previous + 1], bx = points[index], by = points[index + 1];
    if ((ay > py) !== (by > py) && x < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside;
    if (!beyond(x, py, ax, ay, bx, by, limit)) best = Math.min(best, segmentDistanceSq(x, py, ax, ay, bx, by));
  }
  return inside ? Math.sqrt(best) : -Math.sqrt(best);
}

function beyond(x: number, py: number, ax: number, ay: number, bx: number, by: number, limit: number): boolean {
  return x < Math.min(ax, bx) - limit || x > Math.max(ax, bx) + limit || py < Math.min(ay, by) - limit || py > Math.max(ay, by) + limit;
}

function segmentDistanceSq(x: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const along = segmentParameter(x, py, ax, ay, bx, by);
  const dx = x - ax - (bx - ax) * along, dy = py - ay - (by - ay) * along;
  return dx * dx + dy * dy;
}

function segmentParameter(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const lengthSq = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
  return lengthSq > 0 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / lengthSq)) : 0;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Polynomial smooth maximum: landforms join without a crease where they meet.
function smoothMax(a: number, b: number, k: number): number {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return a + (b - a) * h + k * h * (1 - h);
}

// Seeded gradient noise for crags, outlines and the lowland swell, so every
// platform raises identical ground.
function noise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = corner(ix, iy, fx, fy), b = corner(ix + 1, iy, fx - 1, fy);
  const c = corner(ix, iy + 1, fx, fy - 1), d = corner(ix + 1, iy + 1, fx - 1, fy - 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function corner(ix: number, iy: number, dx: number, dy: number): number {
  let hash = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1);
  hash = Math.imul(hash ^ (hash >>> 15), 0x2c1b3c6d);
  const gradient = ((hash ^ (hash >>> 12)) & 15) * 2;
  return (dx * GRADIENTS[gradient] + dy * GRADIENTS[gradient + 1]) * 1.4;
}

/** Ridged crag detail from -1 to 1. */
function cragNoise(x: number, py: number): number {
  const ridged = 1 - Math.abs(noise(x * 16 + 11.3, py * 16 + 5.9));
  const detail = 1 - Math.abs(noise(x * 27 + 2.7, py * 27 + 17.1));
  return Math.max(-1, Math.min(1, 2 * (0.75 * ridged * ridged + 0.25 * detail * detail) - 0.9));
}

export interface ReliefGroup {
  start: number;
  count: number;
  /** 0 is the painted surface; 1 is the slab's chamfer, sides and underside. */
  materialIndex: 0 | 1;
}

export interface ReliefMesh {
  /** Metres. The painting covers x from -width/2 to width/2 and z from -depth/2 to depth/2. */
  width: number;
  depth: number;
  /** Cells across and down the painted surface. */
  columns: number;
  rows: number;
  /** Painted-surface heights in metres, columns + 1 per row, rows from the north edge. */
  heights: Float32Array;
  minHeight: number;
  maxHeight: number;
  positions: Float32Array;
  normals: Float32Array;
  /** The painted surface maps exactly onto the painting with v up; the slab tiles in map widths. */
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
  groups: readonly ReliefGroup[];
  vertexCount: number;
  triangleCount: number;
}

/**
 * Builds the slab for a map `width` metres wide with `segments` cells across:
 * the painted relief (group 0) and its chamfered sides and underside (group 1).
 */
export function buildReliefMesh(width: number, segments: number): ReliefMesh {
  const slices = reliefMeshSlices(width, segments, Infinity);
  let slice = slices.next();
  while (!slice.done) slice = slices.next();
  return slice.value;
}

/**
 * The same build in slices, so a platform can spread it across frames and
 * keep every task short: each next() raises up to `rowsPerSlice` rows of the
 * surface, then assembles the mesh in larger row bands. Call next() within a
 * per-frame time budget until it is done; each yield is the share done.
 */
export function* reliefMeshSlices(width: number, segments: number, rowsPerSlice = 8): Generator<number, ReliefMesh, void> {
  if (!(width > 0) || !Number.isFinite(width)) throw new RangeError("Relief width must be a positive number of metres.");
  const columns = Math.max(8, Math.round(Number.isFinite(segments) ? segments : 8));
  const rows = Math.max(6, Math.round(columns * RELIEF_ASPECT));
  const depth = width * RELIEF_ASPECT;
  const stride = columns + 1;
  const surfaceCount = stride * (rows + 1);
  const heights = new Float32Array(surfaceCount);
  const near: CompiledForm[] = [];
  const slice = Math.max(1, rowsPerSlice);
  for (let r = 0; r <= rows; r++) {
    const y = r / rows;
    near.length = 0;
    for (const entry of compiled) if (y >= entry.y0 && y <= entry.y1) near.push(entry);
    for (let c = 0; c <= columns; c++) heights[r * stride + c] = elevate(c / columns, y, near, near.length, true) * width;
    if ((r + 1) % slice === 0 && r < rows) yield (0.8 * (r + 1)) / (rows + 1);
  }
  yield 0.8;

  // Each side repeats its edge vertices four times (chamfer top and foot, wall
  // top and foot); the underside adds four corners.
  const sides = [columns, rows, columns, rows];
  const skirtCount = 4 * (2 * columns + 2 * rows + 4) + 4;
  const vertexCount = surfaceCount + skirtCount;
  const topTriangles = 2 * columns * rows;
  const triangleCount = topTriangles + 4 * (2 * columns + 2 * rows) + 2;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = vertexCount > 65535 ? new Uint32Array(triangleCount * 3) : new Uint16Array(triangleCount * 3);

  const cellW = width / columns, cellD = depth / rows;
  let minHeight = Infinity, maxHeight = -Infinity;
  for (let r = 0; r <= rows; r++) {
    const north = Math.max(0, r - 1), south = Math.min(rows, r + 1);
    for (let c = 0; c <= columns; c++) {
      const index = r * stride + c, height = heights[index];
      const west = Math.max(0, c - 1), east = Math.min(columns, c + 1);
      const slopeX = (heights[r * stride + east] - heights[r * stride + west]) / (cellW * (east - west));
      const slopeZ = (heights[south * stride + c] - heights[north * stride + c]) / (cellD * (south - north));
      const length = Math.sqrt(slopeX * slopeX + 1 + slopeZ * slopeZ);
      minHeight = Math.min(minHeight, height);
      maxHeight = Math.max(maxHeight, height);
      positions[index * 3] = c * cellW - width / 2;
      positions[index * 3 + 1] = height;
      positions[index * 3 + 2] = r * cellD - depth / 2;
      normals[index * 3] = -slopeX / length;
      normals[index * 3 + 1] = 1 / length;
      normals[index * 3 + 2] = -slopeZ / length;
      uvs[index * 2] = c / columns;
      uvs[index * 2 + 1] = 1 - r / rows;
    }
    if ((r + 1) % (slice * 4) === 0 && r < rows) yield 0.8 + (0.1 * (r + 1)) / (rows + 1);
  }
  yield 0.9;

  let cursor = 0;
  const triangle = (a: number, b: number, c: number) => {
    indices[cursor++] = a;
    indices[cursor++] = b;
    indices[cursor++] = c;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const a = r * stride + c, b = a + 1, below = a + stride, d = below + 1;
      if (splitsDown(heights, a, b, below, d)) {
        triangle(a, below, d);
        triangle(a, d, b);
      } else {
        triangle(a, below, b);
        triangle(b, below, d);
      }
    }
    if ((r + 1) % (slice * 4) === 0 && r < rows - 1) yield 0.9 + (0.09 * (r + 1)) / rows;
  }

  // Sides run clockwise seen from above: north (west to east), east, south, west.
  const rim = RELIEF_LEVELS.rim * width, chamfer = RELIEF_SLAB.chamfer * width, base = RELIEF_SLAB.base * width;
  const bevel = Math.SQRT1_2, slant = (chamfer * Math.SQRT2) / width, wall = (rim - chamfer - base) / width;
  let vertex = surfaceCount, perimeter = 0;
  const put = (at: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number) => {
    positions[at * 3] = x;
    positions[at * 3 + 1] = y;
    positions[at * 3 + 2] = z;
    normals[at * 3] = nx;
    normals[at * 3 + 1] = ny;
    normals[at * 3 + 2] = nz;
    uvs[at * 2] = u;
    uvs[at * 2 + 1] = v;
  };
  for (let side = 0; side < 4; side++) {
    const n = sides[side], length = side % 2 ? depth : width;
    const outX = side === 1 ? 1 : side === 3 ? -1 : 0, outZ = side === 0 ? -1 : side === 2 ? 1 : 0;
    const alongX = -outZ, alongZ = outX;
    for (let i = 0; i <= n; i++) {
      const edge = side === 0 ? i : side === 1 ? i * stride + columns : side === 2 ? rows * stride + columns - i : (rows - i) * stride;
      const ex = positions[edge * 3], ez = positions[edge * 3 + 2];
      // The outer lines run past each corner by the chamfer, so neighbouring sides meet on a mitre.
      const past = (i / n) * 2 * chamfer - chamfer;
      const ox = ex + outX * chamfer + alongX * past, oz = ez + outZ * chamfer + alongZ * past;
      const u = (perimeter + (i / n) * length) / width, at = vertex + i * 4;
      put(at, ex, rim, ez, outX * bevel, bevel, outZ * bevel, u, 0);
      put(at + 1, ox, rim - chamfer, oz, outX * bevel, bevel, outZ * bevel, u, slant);
      put(at + 2, ox, rim - chamfer, oz, outX, 0, outZ, u, slant);
      put(at + 3, ox, base, oz, outX, 0, outZ, u, slant + wall);
    }
    for (let i = 0; i < n; i++) {
      const top = vertex + i * 4, next = top + 4;
      triangle(top, next, next + 1);
      triangle(top, next + 1, top + 1);
      triangle(top + 2, next + 2, next + 3);
      triangle(top + 2, next + 3, top + 3);
    }
    vertex += (n + 1) * 4;
    perimeter += length;
  }
  const halfW = width / 2 + chamfer, halfD = depth / 2 + chamfer;
  put(vertex, -halfW, base, -halfD, 0, -1, 0, 0, 0);
  put(vertex + 1, halfW, base, -halfD, 0, -1, 0, 1, 0);
  put(vertex + 2, halfW, base, halfD, 0, -1, 0, 1, RELIEF_ASPECT);
  put(vertex + 3, -halfW, base, halfD, 0, -1, 0, 0, RELIEF_ASPECT);
  triangle(vertex, vertex + 1, vertex + 2);
  triangle(vertex, vertex + 2, vertex + 3);

  return {
    width, depth, columns, rows, heights, minHeight, maxHeight, positions, normals, uvs, indices,
    groups: [
      { start: 0, count: topTriangles * 3, materialIndex: 0 },
      { start: topTriangles * 3, count: (triangleCount - topTriangles) * 3, materialIndex: 1 },
    ],
    vertexCount, triangleCount,
  };
}

/**
 * Height in metres of a built surface at relief-space x and z, interpolated
 * across the same triangles the mesh draws; NaN off the painting. Allocation free.
 */
export function sampleReliefSurface(mesh: ReliefMesh, x: number, z: number): number {
  const gx = (x / mesh.width + 0.5) * mesh.columns, gz = (z / mesh.depth + 0.5) * mesh.rows;
  if (!(gx >= 0 && gx <= mesh.columns && gz >= 0 && gz <= mesh.rows)) return NaN;
  const c = Math.min(mesh.columns - 1, Math.floor(gx)), r = Math.min(mesh.rows - 1, Math.floor(gz));
  const fx = gx - c, fz = gz - r, stride = mesh.columns + 1;
  const a = mesh.heights[r * stride + c], b = mesh.heights[r * stride + c + 1];
  const below = mesh.heights[(r + 1) * stride + c], d = mesh.heights[(r + 1) * stride + c + 1];
  if (Math.abs(a - d) < Math.abs(b - below)) return fx >= fz ? a + (b - a) * fx + (d - b) * fz : a + (below - a) * fz + (d - below) * fx;
  return fx + fz <= 1 ? a + (b - a) * fx + (below - a) * fz : d + (below - d) * (1 - fx) + (b - d) * (1 - fz);
}

// Each cell splits along the diagonal whose corners are closer in height, so
// slopes are cut along their contours rather than across them; ties take the
// other diagonal. The mesh, sampleReliefSurface and intersectRelief all agree.
function splitsDown(heights: Float32Array, a: number, b: number, below: number, d: number): boolean {
  return Math.abs(heights[a] - heights[d]) < Math.abs(heights[b] - heights[below]);
}

/**
 * Distance along a relief-space ray to the painted surface, or -1 when it
 * misses. It walks only the cells under the ray, so pointer hover and XR rays
 * stay cheap without raycasting the whole mesh. The direction need not be
 * normalised. Allocation free.
 */
export function intersectRelief(mesh: ReliefMesh, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
  const halfW = mesh.width / 2, halfD = mesh.depth / 2;
  clipNear = 0;
  clipFar = Infinity;
  if (!clip(ox, dx, -halfW, halfW) || !clip(oy, dy, mesh.minHeight, mesh.maxHeight) || !clip(oz, dz, -halfD, halfD)) return -1;
  const cellW = mesh.width / mesh.columns, cellD = mesh.depth / mesh.rows, stride = mesh.columns + 1;
  const startX = (ox + dx * clipNear + halfW) / cellW, startZ = (oz + dz * clipNear + halfD) / cellD;
  let c = Math.max(0, Math.min(mesh.columns - 1, Math.floor(startX)));
  let r = Math.max(0, Math.min(mesh.rows - 1, Math.floor(startZ)));
  const stepC = dx > 0 ? 1 : -1, stepR = dz > 0 ? 1 : -1;
  const deltaC = dx !== 0 ? cellW / Math.abs(dx) : Infinity, deltaR = dz !== 0 ? cellD / Math.abs(dz) : Infinity;
  let nextC = dx !== 0 ? clipNear + (dx > 0 ? c + 1 - startX : startX - c) * deltaC : Infinity;
  let nextR = dz !== 0 ? clipNear + (dz > 0 ? r + 1 - startZ : startZ - r) * deltaR : Infinity;
  for (let guard = mesh.columns + mesh.rows + 2; guard > 0; guard--) {
    const a = r * stride + c, b = a + 1, below = a + stride, d = below + 1;
    const down = splitsDown(mesh.heights, a, b, below, d);
    const first = down ? triangleHit(mesh, a, below, d, ox, oy, oz, dx, dy, dz) : triangleHit(mesh, a, below, b, ox, oy, oz, dx, dy, dz);
    const second = down ? triangleHit(mesh, a, d, b, ox, oy, oz, dx, dy, dz) : triangleHit(mesh, b, below, d, ox, oy, oz, dx, dy, dz);
    const hit = first < 0 ? second : second < 0 ? first : Math.min(first, second);
    if (hit >= 0) return hit;
    if (Math.min(nextC, nextR) > clipFar) return -1;
    if (nextC < nextR) {
      c += stepC;
      nextC += deltaC;
    } else {
      r += stepR;
      nextR += deltaR;
    }
    if (c < 0 || c >= mesh.columns || r < 0 || r >= mesh.rows) return -1;
  }
  return -1;
}

function clip(origin: number, direction: number, low: number, high: number): boolean {
  if (direction === 0) return origin >= low && origin <= high;
  const t0 = (low - origin) / direction, t1 = (high - origin) / direction;
  clipNear = Math.max(clipNear, Math.min(t0, t1));
  clipFar = Math.min(clipFar, Math.max(t0, t1));
  return clipNear <= clipFar;
}

// Möller-Trumbore against one surface triangle, read straight from positions.
function triangleHit(mesh: ReliefMesh, i0: number, i1: number, i2: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
  const p = mesh.positions;
  const ax = p[i0 * 3], ay = p[i0 * 3 + 1], az = p[i0 * 3 + 2];
  const e1x = p[i1 * 3] - ax, e1y = p[i1 * 3 + 1] - ay, e1z = p[i1 * 3 + 2] - az;
  const e2x = p[i2 * 3] - ax, e2y = p[i2 * 3 + 1] - ay, e2z = p[i2 * 3 + 2] - az;
  const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
  const det = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(det) < 1e-14) return -1;
  const sx = ox - ax, sy = oy - ay, sz = oz - az;
  const u = (sx * hx + sy * hy + sz * hz) / det;
  if (u < -1e-7 || u > 1 + 1e-7) return -1;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) / det;
  if (v < -1e-7 || u + v > 1 + 1e-7) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) / det;
  return t >= 0 ? t : -1;
}

/** Image fractions to relief-space metres: x east of centre, z south of centre. */
export function imageToRelief(x: number, y: number, width: number, out: [number, number] = [0, 0]): [number, number] {
  out[0] = (x - 0.5) * width;
  out[1] = (y - 0.5) * width * RELIEF_ASPECT;
  return out;
}

/** Relief-space metres back to image fractions. */
export function reliefToImage(x: number, z: number, width: number, out: [number, number] = [0, 0]): [number, number] {
  out[0] = x / width + 0.5;
  out[1] = z / (width * RELIEF_ASPECT) + 0.5;
  return out;
}

/**
 * Hotspot markers in map widths. `radius` is the pick area, 6% of the map
 * width so a pinch at arm's length lands; `ring` is the resting ring, 6% of
 * the width across, the smallest the brief allows.
 */
export const RELIEF_MARKER = { radius: 0.06, ring: 0.03 } as const;

export type ReliefHotspotRecord = ChronicleRecord & { nation: ChronicleNationId; hotspot: ChronicleHotspot };

export interface ReliefMarker {
  record: ReliefHotspotRecord;
  /** The surface point under the hotspot, in relief-space metres. */
  x: number;
  y: number;
  z: number;
  /** Pick radius in metres. */
  radius: number;
  /** Resting ring radius in metres. */
  ring: number;
  /** The highest surface under the ring, so a flat ring at this height clears the ground. */
  clearance: number;
}

/** One marker per Atlas hotspot, in getHotspotRecords order, on this mesh's surface. */
export function getReliefMarkers(mesh: ReliefMesh): ReliefMarker[] {
  return getHotspotRecords().map((record) => {
    const [x, z] = imageToRelief(record.hotspot.x, record.hotspot.y, mesh.width);
    const y = sampleReliefSurface(mesh, x, z);
    const ring = RELIEF_MARKER.ring * mesh.width;
    let clearance = y;
    for (let step = 1; step <= 4; step++) {
      for (let spoke = 0; spoke < 24; spoke++) {
        const angle = (spoke / 24) * Math.PI * 2, reach = (ring * step) / 4;
        clearance = Math.max(clearance, sampleReliefSurface(mesh, x + Math.cos(angle) * reach, z + Math.sin(angle) * reach));
      }
    }
    return { record, x, y, z, radius: RELIEF_MARKER.radius * mesh.width, ring, clearance };
  });
}

/**
 * The hotspot whose pick area holds a relief-space point in metres, measured
 * across the map plane; null over empty ground and the centre. Pair it with
 * intersectRelief, or a ray hit on the mesh, to select on the terrain.
 * Allocation free.
 */
export function reliefHotspotAt(x: number, z: number, width: number, radius: number = RELIEF_MARKER.radius): ChronicleRecord | null {
  if (!(width > 0)) return null;
  return hotspotAt(x / width + 0.5, z / (width * RELIEF_ASPECT) + 0.5, radius);
}

/**
 * A camera framing. The camera looks at the surface under `target`, an
 * image-fraction point, from `distance` map widths away. `azimuth` and
 * `elevation` are radians: azimuth 0 looks north from beyond the south edge
 * and positive swings the eye east; elevation is above the map plane.
 */
export interface ReliefView {
  target: Point;
  distance: number;
  azimuth: number;
  elevation: number;
}

/** The vertical field of view in degrees that view distances are authored for. */
export const RELIEF_FOV = 35;

// The overview holds the whole slab at 16:9 with the painted labels readable.
// Each nation leans in from across the map so its painted faces stay toward the eye.
export const RELIEF_VIEWS: Readonly<Record<"overview" | ChronicleNationId, ReliefView>> = {
  overview: { target: [0.5, 0.52], distance: 1.25, azimuth: 0, elevation: 0.96 },
  korvenia: { target: [0.2, 0.25], distance: 0.5, azimuth: 0.18, elevation: 0.92 },
  solforiz: { target: [0.78, 0.74], distance: 0.54, azimuth: -0.14, elevation: 0.95 },
  aethelgard: { target: [0.8, 0.24], distance: 0.5, azimuth: -0.18, elevation: 0.92 },
  "kwind-09": { target: [0.22, 0.75], distance: 0.55, azimuth: 0.14, elevation: 0.95 },
};

/**
 * Bounds for orbiting, tilting, zooming and panning: azimuth and elevation in
 * radians, distance in map widths, the target in image fractions. Wider turns
 * would show the painting's south-facing faces side on; the far distance
 * still admits the overview fitted to a square viewport.
 */
export const RELIEF_CAMERA_LIMITS = {
  azimuth: [-0.35, 0.35],
  elevation: [0.72, 1.38],
  distance: [0.3, 2],
  target: { x: [0.1, 0.9], y: [0.12, 0.88] },
} as const;

export interface ReliefPose {
  position: [number, number, number];
  target: [number, number, number];
}

/** A view's eye and look-at point in relief-space metres for a map `width` wide. Allocation free with `out`. */
export function getReliefViewPose(view: ReliefView, width: number, out: ReliefPose = { position: [0, 0, 0], target: [0, 0, 0] }): ReliefPose {
  imageToRelief(view.target[0], view.target[1], width, scratch);
  const x = scratch[0], z = scratch[1];
  const ground = reliefHeightAt(view.target[0], view.target[1]) * width;
  const reach = view.distance * width, level = reach * Math.cos(view.elevation);
  out.target[0] = x;
  out.target[1] = ground;
  out.target[2] = z;
  out.position[0] = x + level * Math.sin(view.azimuth);
  out.position[1] = ground + reach * Math.sin(view.elevation);
  out.position[2] = z + level * Math.cos(view.azimuth);
  return out;
}

/**
 * The distance in map widths at which a view holds the whole slab, for a
 * vertical field of view in degrees and a viewport aspect ratio, keeping
 * `margin` of the frame clear on every side.
 */
export function fitReliefDistance(view: ReliefView, fov: number, aspect: number, margin = 0.04): number {
  const tanV = Math.tan((fov * Math.PI) / 360) * (1 - margin), tanH = tanV * aspect;
  const ce = Math.cos(view.elevation), se = Math.sin(view.elevation);
  const ca = Math.cos(view.azimuth), sa = Math.sin(view.azimuth);
  const tx = view.target[0] - 0.5, tz = (view.target[1] - 0.5) * RELIEF_ASPECT;
  const ty = reliefHeightAt(view.target[0], view.target[1]);
  const halfW = 0.5 + RELIEF_SLAB.chamfer, halfD = RELIEF_ASPECT / 2 + RELIEF_SLAB.chamfer;
  let distance = 0;
  // Every corner of the slab's bounds, from its underside to the highest peak.
  for (let corner = 0; corner < 8; corner++) {
    const qx = (corner & 1 ? halfW : -halfW) - tx;
    const qz = (corner & 2 ? halfD : -halfD) - tz;
    const qy = (corner & 4 ? PEAK_BOUND : RELIEF_SLAB.base) - ty;
    const toward = qx * ce * sa + qy * se + qz * ce * ca;
    const right = qx * ca - qz * sa;
    const up = -qx * sa * se + qy * ce - qz * ca * se;
    distance = Math.max(distance, toward + Math.abs(right) / tanH, toward + Math.abs(up) / tanV);
  }
  return distance;
}

/** A view whose target can be written in place, for clamping and blending without allocation. */
export interface ReliefViewState extends ReliefView {
  target: [x: number, y: number];
}

const newViewState = (): ReliefViewState => ({ target: [0.5, 0.5], distance: 1, azimuth: 0, elevation: 1 });

/** A view held inside RELIEF_CAMERA_LIMITS; non-finite values fall back to the overview's. */
export function clampReliefView(view: ReliefView, out: ReliefViewState = newViewState()): ReliefViewState {
  const limits = RELIEF_CAMERA_LIMITS, home = RELIEF_VIEWS.overview;
  out.target[0] = within(view.target[0], limits.target.x, home.target[0]);
  out.target[1] = within(view.target[1], limits.target.y, home.target[1]);
  out.distance = within(view.distance, limits.distance, home.distance);
  out.azimuth = within(view.azimuth, limits.azimuth, home.azimuth);
  out.elevation = within(view.elevation, limits.elevation, home.elevation);
  return out;
}

function within(value: number, range: readonly [number, number], fallback: number): number {
  return Math.max(range[0], Math.min(range[1], Number.isFinite(value) ? value : fallback));
}

/**
 * Part of the way from one view to another, `amount` from 0 to 1. Distance
 * moves geometrically so a zoom feels even. Each platform eases `amount` to
 * its own timing, and jumps straight to 1 for reduced motion.
 */
export function blendReliefViews(from: ReliefView, to: ReliefView, amount: number, out: ReliefViewState = newViewState()): ReliefViewState {
  const t = Math.max(0, Math.min(1, Number.isFinite(amount) ? amount : 1));
  out.target[0] = from.target[0] + (to.target[0] - from.target[0]) * t;
  out.target[1] = from.target[1] + (to.target[1] - from.target[1]) * t;
  out.distance = from.distance > 0 && to.distance > 0 ? from.distance * Math.pow(to.distance / from.distance, t) : from.distance + (to.distance - from.distance) * t;
  out.azimuth = from.azimuth + (to.azimuth - from.azimuth) * t;
  out.elevation = from.elevation + (to.elevation - from.elevation) * t;
  return out;
}

/** An image-fraction anchor with a radius in map widths and a relative strength. */
export interface ReliefGlow {
  at: Point;
  radius: number;
  strength: number;
}

/** A mist bank: centre, half-extents in map widths, and its band above the surface in map widths. */
export interface ReliefMist {
  at: Point;
  reach: readonly [x: number, y: number];
  lift: readonly [low: number, high: number];
}

const filled = (fill: ReliefFill) => RELIEF_LANDFORMS.filter((form): form is Landform<"cone" | "basin" | "channel"> =>
  (form.kind === "cone" || form.kind === "basin" || form.kind === "channel") && form.fill === fill);

// Restrained living details, as data only. Each platform decides how to
// animate them, and holds them still for reduced motion.
export const RELIEF_DETAILS = {
  /** The painted eclipse over Korvenia; its violet light hangs `lift` map widths above `light`, and fires burn in the city. */
  eclipse: {
    at: [0.093, 0.066] as Point,
    radius: 0.033,
    light: [0.17, 0.2] as Point,
    lift: 0.16,
    fires: [{ at: [0.236, 0.352], radius: 0.012, strength: 1 }, { at: [0.112, 0.332], radius: 0.01, strength: 0.7 }] as readonly ReliefGlow[],
  },
  /** Crater, pool and rift glows in Solforiz, from the lava-filled landforms. */
  embers: filled("lava").flatMap((form): ReliefGlow[] =>
    form.kind === "channel" ? form.path.map((at) => ({ at, radius: form.width, strength: 0.8 }))
      : form.kind === "cone" ? [{ at: form.at, radius: form.crater * 1.6, strength: 1 }]
        : [{ at: form.at, radius: form.radius, strength: 0.9 }]) as readonly ReliefGlow[],
  /** The open lowland's mist first, then the cloud banks the painting shows elsewhere. */
  mist: [
    { at: [0.51, 0.5], reach: [0.1, 0.09], lift: [0.004, 0.03] },
    { at: [0.84, 0.46], reach: [0.16, 0.03], lift: [0.01, 0.045] },
    { at: [0.08, 0.53], reach: [0.08, 0.03], lift: [0.012, 0.04] },
    { at: [0.47, 0.06], reach: [0.09, 0.035], lift: [0.03, 0.07] },
  ] as readonly ReliefMist[],
  /**
   * The seas fill each coast up to elevation 0, so one plane at sea level
   * shimmers only where the relief dips below it. Rivers, the falls pool and
   * the falls themselves sit above the sea.
   */
  water: {
    seas: RELIEF_LANDFORMS.filter((form): form is Landform<"sea"> => form.kind === "sea").map((form) => form.coast),
    rivers: filled("water").filter((form): form is Landform<"channel"> => form.kind === "channel").map((form) => ({ path: form.path, width: form.width })),
    pools: filled("water").filter((form): form is Landform<"basin"> => form.kind === "basin").map((form) => ({ at: form.at, radius: form.radius })),
    falls: [{ top: [0.342, 0.05], bottom: [0.342, 0.13], width: 0.018 }, { top: [0.7, 0.27], bottom: [0.7, 0.36], width: 0.016 }] as readonly { top: Point; bottom: Point; width: number }[],
  },
};
