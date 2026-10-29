// Deterministic seeded helpers. Shared Legacy code never touches Math.random:
// callers pass a seed and the same seed always produces the same sequence.

/** 32-bit FNV-1a hash of a string, as an unsigned integer. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Normalises any number into an unsigned 32-bit seed (non-finite values become 0). */
export function toSeed(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.trunc(value) >>> 0;
}

/** Combines a seed with a salt so independent draws never share a sequence. */
export function mixSeed(seed: number, salt: string): number {
  return (hashString(salt) ^ Math.imul(toSeed(seed) ^ 0x9e3779b9, 0x85ebca6b)) >>> 0;
}

/** mulberry32: small, fast and good enough for name and variation choices. Returns values in [0, 1). */
export function createSeededRandom(seed: number): () => number {
  let state = toSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded Fisher–Yates shuffle that returns a new array and leaves the input untouched. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice();
  const random = createSeededRandom(seed);
  for (let index = out.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    const held = out[index];
    out[index] = out[swap];
    out[swap] = held;
  }
  return out;
}

/** Eight lowercase hex digits for compact deterministic ids. */
export function hex32(value: number): string {
  const text = (value >>> 0).toString(16);
  return "00000000".slice(text.length) + text;
}
