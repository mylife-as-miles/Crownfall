// Browser storage for Legacy saves. The shared persistence layer validates and
// serialises; this adapter only shields it from browsers that refuse storage.

import type { LegacyStorageLike } from '../../../shared/legacy/domain/persistence';

/** window.localStorage when this browser allows it, otherwise null (progress then lasts for the visit). */
export function browserLegacyStorage(): LegacyStorageLike | null {
  try {
    const storage = window.localStorage;
    // Some private modes expose localStorage but throw on access.
    storage.getItem('crownfall.legacy.probe');
    return storage;
  } catch {
    return null;
  }
}
