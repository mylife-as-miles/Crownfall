// Browser storage adapter for Legacy persistence. Reading localStorage can
// throw (privacy modes, sandboxed frames), so access is guarded and a missing
// store is reported as null; the shared session logic then keeps the banner in
// memory and says so.

import type { LegacyStorageLike } from "../../../shared/legacy/domain/persistence";

export function getLegacyStorage(): LegacyStorageLike | null {
  try {
    const storage = window.localStorage;
    if (!storage) return null;
    return {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => storage.setItem(key, value),
      removeItem: (key) => storage.removeItem(key),
    };
  } catch {
    return null;
  }
}

/** ISO timestamp for domain events; shared Legacy code never reads the clock itself. */
export function legacyTimestamp(): string {
  return new Date().toISOString();
}

/** A fresh unsigned 32-bit seed for one founding ceremony. */
export function foundingSeed(): number {
  try {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  } catch {
    return Math.floor(Math.random() * 0xffffffff) >>> 0;
  }
}
