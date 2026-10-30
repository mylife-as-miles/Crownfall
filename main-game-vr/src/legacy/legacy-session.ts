// Where this visit's banner lives, and every write to it. Wraps the shared
// session resolution and persistence so the rule "only a persistent production
// session with working storage ever writes" lives in one pure place that is
// unit-tested with a fake storage; the IWSDK experience only calls it.

import { clearLegacy, saveLegacy } from '../../../shared/legacy/domain/persistence';
import type { LegacyPreviewSource, LegacySession, LegacyStorageLike } from '../../../shared/legacy/domain/persistence';
import { resolveLegacySessionLazily } from '../../../shared/legacy/domain/preview-loader';
import { reduceLegacy } from '../../../shared/legacy/domain/reducer';
import { createLegacyState } from '../../../shared/legacy/domain/state';
import { LEGACY_COPY } from '../../../shared/legacy/content/copy';
import type { LegacyEvent, LegacyState } from '../../../shared/legacy/types';
import type { LegacySessionInfo } from './legacy-view-model.js';

export type LegacySaveStatus = 'saved' | 'failed' | 'none';

export class LegacySessionController {
  private current: LegacySession | null = null;
  private legacyState: LegacyState = createLegacyState();
  private status: LegacySaveStatus = 'none';
  /** A banner has been written to storage during this visit (a new or replacing founding). */
  private savedOnce = false;

  constructor(private readonly storage: LegacyStorageLike | null) {}

  get session(): LegacySession | null { return this.current; }
  get state(): LegacyState { return this.legacyState; }
  get saveStatus(): LegacySaveStatus { return this.status; }

  /** Resolves the visit's session once: ?legacy=fresh, ?legacyPreview=<id>, the stored banner or a new one. */
  async resolve(search: string, at: string, loadPreviews?: () => Promise<LegacyPreviewSource>): Promise<LegacySession> {
    const session = await resolveLegacySessionLazily(search, this.storage, loadPreviews ? { at, loadPreviews } : { at });
    this.current = session;
    this.legacyState = session.state;
    return session;
  }

  /** Saving is real only for a persistent session with working storage and a production state. */
  canSave(): boolean {
    return !!this.current && this.current.persistent && this.storage !== null && this.legacyState.mode === 'production';
  }

  info(): LegacySessionInfo {
    const session = this.current;
    const persistent = this.canSave();
    const saveFailed = this.status === 'failed';
    if (!session) return { kind: 'new', persistent, saved: false, saveFailed, label: null, error: null, reason: null, title: null };
    switch (session.kind) {
      case 'guest': return { kind: 'guest', persistent: false, saved: false, saveFailed: false, label: session.label, error: null, reason: null, title: null };
      case 'preview': return { kind: 'preview', persistent: false, saved: false, saveFailed: false, label: session.label, error: null, reason: null, title: session.title };
      case 'preview-missing': return { kind: 'preview-missing', persistent: false, saved: false, saveFailed: false, label: session.label, error: session.error, reason: null, title: null };
      case 'unavailable': return { kind: 'unavailable', persistent: false, saved: false, saveFailed: false, label: null, error: session.error, reason: 'unavailable', title: null };
      case 'recovery':
        // Once a new banner has been saved over the unreadable record, the session is an ordinary stored one.
        return this.savedOnce
          ? { kind: 'stored', persistent, saved: !saveFailed, saveFailed, label: null, error: null, reason: null, title: null }
          : { kind: 'recovery', persistent, saved: false, saveFailed, label: null, error: session.error, reason: session.reason, title: null };
      case 'new':
        return { kind: this.savedOnce ? 'stored' : 'new', persistent, saved: this.savedOnce && !saveFailed, saveFailed, label: null, error: null, reason: null, title: null };
      case 'stored':
        // A banner loaded from storage is on this device until a write fails or it is dissolved.
        return { kind: 'stored', persistent, saved: (this.savedOnce || this.legacyState.banner !== null) && !saveFailed, saveFailed, label: null, error: null, reason: null, title: null };
    }
  }

  /**
   * Applies a domain event, saving when the session may. Returns the refusal or save error to show, or null.
   * A refusal leaves the state as it was.
   */
  commit(event: LegacyEvent): { changed: boolean; error: string | null } {
    const transition = reduceLegacy(this.legacyState, event);
    if (transition.error) return { changed: false, error: transition.error };
    if (transition.state === this.legacyState) return { changed: false, error: null };
    this.legacyState = transition.state;
    if (this.canSave() && this.storage) {
      const saved = saveLegacy(this.storage, this.legacyState);
      this.status = saved.ok ? 'saved' : 'failed';
      if (saved.ok) this.savedOnce = true;
      else return { changed: true, error: saved.error };
    }
    return { changed: true, error: null };
  }

  /** Dissolves the banner, clearing storage only for a persistent production session. */
  dissolve(at: string): string | null {
    if (this.legacyState.mode === 'preview') return LEGACY_COPY.preview.locked;
    const transition = reduceLegacy(this.legacyState, { type: 'reset', at });
    if (transition.error) return transition.error;
    // A refused storage clear must leave the live banner and its saved status intact,
    // so Cancel/Retry still refer to the same house shown by the confirmation.
    if (this.canSave() && this.storage) {
      const cleared = clearLegacy(this.storage);
      if (!cleared.ok) return cleared.error;
    }
    this.legacyState = transition.state;
    this.status = 'none';
    this.savedOnce = false;
    return null;
  }

  /** Leaves an unreadable save untouched and continues with an in-memory guest banner. */
  continueAsGuest(at: string): void {
    this.current = { kind: 'guest', persistent: false, state: createLegacyState({ at }), label: LEGACY_COPY.guest.label };
    this.legacyState = this.current.state;
    this.status = 'none';
  }
}
