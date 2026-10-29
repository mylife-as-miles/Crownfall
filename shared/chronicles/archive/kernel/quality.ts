// Per-quality tessellation for the archive kernel. Quest is the coarsest tier;
// desktop low, medium and high add segments where silhouettes and mouldings
// read. Builders ask for segment counts here instead of hard-coding them.

import type { ArchiveQuality } from "../types";

export interface Tessellation {
  /** Segments per metre of arc length along large curves (arches, vaults, rings). */
  arcDensity: number;
  /** Bounds on segments for any curve, per radian of turn. */
  minPerRadian: number;
  maxPerRadian: number;
  /** Segments around a full lathe of radius 1 m; smaller radii scale down, never below `latheMin`. */
  lathe: number;
  latheMin: number;
  /** Segments per metre of profile curve (mouldings); a curved profile element never has fewer than `profileMin`. */
  profileDensity: number;
  profileMin: number;
  /** Floor and large flat panels are split into cells about this size, for the vertex bake. */
  cell: number;
  /** Vault: rings of the shell from springing to oculus and segments around each web. */
  vaultRings: number;
  vaultWebSegments: number;
  /** Voussoir joints and coffer grooves are cut as geometry from this tier up. */
  cutJoints: boolean;
  /** Balusters per metre of balustrade (0 replaces them with a solid parapet). */
  balusterDensity: number;
}

export const TESSELLATION: Readonly<Record<ArchiveQuality, Tessellation>> = {
  quest: { arcDensity: 2.2, minPerRadian: 2.5, maxPerRadian: 10, lathe: 14, latheMin: 6, profileDensity: 22, profileMin: 1, cell: 1.2, vaultRings: 10, vaultWebSegments: 4, cutJoints: false, balusterDensity: 0 },
  low: { arcDensity: 2.6, minPerRadian: 3, maxPerRadian: 12, lathe: 16, latheMin: 6, profileDensity: 26, profileMin: 2, cell: 1.0, vaultRings: 12, vaultWebSegments: 5, cutJoints: false, balusterDensity: 0 },
  medium: { arcDensity: 5, minPerRadian: 5, maxPerRadian: 20, lathe: 28, latheMin: 8, profileDensity: 48, profileMin: 3, cell: 0.6, vaultRings: 22, vaultWebSegments: 8, cutJoints: true, balusterDensity: 4.2 },
  high: { arcDensity: 7.5, minPerRadian: 7, maxPerRadian: 28, lathe: 40, latheMin: 10, profileDensity: 70, profileMin: 4, cell: 0.45, vaultRings: 30, vaultWebSegments: 12, cutJoints: true, balusterDensity: 4.2 },
};

/** Segments for an arc of `angle` radians and `radius` metres. */
export function arcSegments(quality: ArchiveQuality, angle: number, radius: number): number {
  const t = TESSELLATION[quality];
  const turn = Math.abs(angle);
  const byLength = Math.ceil(turn * Math.abs(radius) * t.arcDensity);
  const low = Math.max(1, Math.ceil(turn * t.minPerRadian)), high = Math.max(low, Math.ceil(turn * t.maxPerRadian));
  return Math.max(low, Math.min(high, byLength));
}

/** Segments around a full lathe of `radius` metres. */
export function latheSegments(quality: ArchiveQuality, radius: number): number {
  const t = TESSELLATION[quality];
  const scaled = Math.round(t.lathe * Math.min(1, Math.sqrt(Math.max(radius, 0.01))));
  // Multiples of four keep lathed forms symmetric on both axes.
  return Math.max(t.latheMin, Math.ceil(Math.max(t.latheMin, scaled) / 4) * 4);
}

/** Segments for a curved moulding element of arc length `length` metres. */
export function profileSegments(quality: ArchiveQuality, length: number): number {
  const t = TESSELLATION[quality];
  return Math.max(t.profileMin, Math.min(12, Math.ceil(length * t.profileDensity)));
}
