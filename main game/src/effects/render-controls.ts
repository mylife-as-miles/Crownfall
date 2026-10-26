export type FrameLimit = 0 | 30 | 60 | 120;

export function normalizeRenderScale(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(50, value)) : 100;
}

export function normalizeFrameLimit(value: number): FrameLimit {
  return value === 30 || value === 60 || value === 120 ? value : 0;
}

export function scaledPixelRatio(devicePixelRatio: number, scale: number): number {
  return Math.min(devicePixelRatio, 1.5) * normalizeRenderScale(scale) / 100;
}

// Keep the cadence stable when rAF timestamps fall just below a frame boundary.
export function nextRenderTimestamp(
  now: number,
  previous: number,
  limit: FrameLimit,
): number | null {
  if (!limit) return now;
  const interval = 1000 / limit;
  const elapsed = now - previous;
  if (elapsed + 0.1 < interval) return null;
  return now - Math.max(0, elapsed - interval) % interval;
}
