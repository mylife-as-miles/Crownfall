import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultHeraldry } from '../../../shared/legacy/content/heraldry';
import { LEGACY_COPY } from '../../../shared/legacy/content/copy';
import * as fixtures from '../../../shared/legacy/domain/fixtures';
import { LEGACY_STORAGE_KEY, saveLegacy } from '../../../shared/legacy/domain/persistence';
import type { LegacyStorageLike } from '../../../shared/legacy/domain/persistence';
import { reduceLegacy } from '../../../shared/legacy/domain/reducer';
import { createLegacyState } from '../../../shared/legacy/domain/state';
import type { LegacyEvent } from '../../../shared/legacy/types';
import { LegacySessionController } from './legacy-session';

const AT = '2026-10-29T12:00:00.000Z';

/** A storage double that records every call, so a test can prove which sessions touch storage at all. */
class RecordingStorage implements LegacyStorageLike {
  readonly values = new Map<string, string>();
  readonly calls: string[] = [];
  getItem(key: string): string | null { this.calls.push(`get ${key}`); return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.calls.push(`set ${key}`); this.values.set(key, value); }
  removeItem(key: string): void { this.calls.push(`remove ${key}`); this.values.delete(key); }
  writes(): string[] { return this.calls.filter((call) => !call.startsWith('get ')); }
}

const FOUND: LegacyEvent = { type: 'found-banner', name: 'House Noirval', nationId: 'korvenia', heraldry: defaultHeraldry('korvenia'), motto: null, at: AT, seed: 9 };

/** The writes a full visit would make: founding, nominating, reading and accepting, then dissolving. */
function playVisit(controller: LegacySessionController): void {
  if (!controller.state.banner) assert.equal(controller.commit(FOUND).error, null);
  controller.commit({ type: 'nominate', memberId: controller.state.members[0].id, file: 'a', at: AT });
  const challenge = controller.state.notices.find((notice) => notice.kind === 'rival-challenge' && notice.status !== 'resolved');
  if (challenge) {
    controller.commit({ type: 'read-notice', noticeId: challenge.id });
    controller.commit({ type: 'accept-challenge', noticeId: challenge.id, at: AT });
  }
  controller.commit({ type: 'dismiss-aftermath' });
  controller.dissolve(AT);
}

test('a guest session never reads or writes storage, whatever the visit does', async () => {
  const storage = new RecordingStorage();
  storage.values.set(LEGACY_STORAGE_KEY, 'an earlier tester\'s banner');
  const controller = new LegacySessionController(storage);
  const session = await controller.resolve('?legacy=fresh', AT);
  assert.equal(session.kind, 'guest');
  assert.equal(controller.canSave(), false);
  playVisit(controller);
  assert.deepEqual(storage.calls, [], 'not a single storage call');
  assert.equal(controller.info().label, LEGACY_COPY.guest.label);
  assert.equal(controller.info().saved, false);
});

test('development previews and missing previews never touch storage, and cannot be dissolved', async () => {
  for (const search of ['?legacyPreview=captive', '?legacyPreview=no-such-preview']) {
    const storage = new RecordingStorage();
    const controller = new LegacySessionController(storage);
    const session = await controller.resolve(search, AT, async () => fixtures);
    assert.equal(session.kind, search.endsWith('captive') ? 'preview' : 'preview-missing');
    assert.equal(controller.canSave(), false);
    if (session.kind === 'preview') assert.equal(controller.dissolve(AT), LEGACY_COPY.preview.locked, 'a preview cannot be dissolved');
    playVisit(controller);
    assert.deepEqual(storage.calls, [], `${search}: not a single storage call`);
    assert.equal(controller.info().saved, false);
  }
});

test('a stored banner loads, every accepted change saves, and dissolving clears the save', async () => {
  const storage = new RecordingStorage();
  const founded = reduceLegacy(createLegacyState({ at: AT }), FOUND).state;
  assert.equal(saveLegacy(storage, founded).ok, true);
  storage.calls.length = 0;
  const controller = new LegacySessionController(storage);
  assert.equal((await controller.resolve('', AT)).kind, 'stored');
  assert.deepEqual(storage.calls, [`get ${LEGACY_STORAGE_KEY}`], 'resolving only reads');
  assert.equal(controller.info().saved, true, 'a loaded banner is on this device');
  controller.commit({ type: 'nominate', memberId: controller.state.members[0].id, file: 'a', at: AT });
  assert.equal(controller.saveStatus, 'saved');
  assert.match(storage.values.get(LEGACY_STORAGE_KEY) ?? '', /"file":"a"/, 'the nomination is in the save');
  const refused = controller.commit({ type: 'nominate', memberId: 'member-404', file: 'a', at: AT });
  assert.ok(refused.error, 'a refused event reports why');
  assert.equal(refused.changed, false);
  assert.equal(controller.dissolve(AT), null);
  assert.equal(storage.values.has(LEGACY_STORAGE_KEY), false, 'dissolving removes the save');
  assert.equal(controller.state.banner, null);
});

test('a new device saves only once a banner is raised, and the tray then says so', async () => {
  const storage = new RecordingStorage();
  const controller = new LegacySessionController(storage);
  assert.equal((await controller.resolve('', AT)).kind, 'new');
  assert.equal(controller.info().saved, false, 'nothing is saved before founding');
  assert.deepEqual(storage.writes(), []);
  controller.commit(FOUND);
  assert.deepEqual(storage.writes(), [`set ${LEGACY_STORAGE_KEY}`]);
  assert.equal(controller.info().saved, true);
  assert.equal(controller.info().kind, 'stored');
});

test('an unreadable save is left untouched until a new banner replaces it, or the visit continues as a guest', async () => {
  const storage = new RecordingStorage();
  storage.values.set(LEGACY_STORAGE_KEY, '{not json');
  const controller = new LegacySessionController(storage);
  const session = await controller.resolve('', AT);
  assert.equal(session.kind, 'recovery');
  assert.equal(storage.values.get(LEGACY_STORAGE_KEY), '{not json', 'resolving leaves the record exactly as stored');
  assert.equal(controller.info().reason, 'corrupt');
  controller.continueAsGuest(AT);
  playVisit(controller);
  assert.deepEqual(storage.writes(), [], 'a guest continuing after recovery writes nothing');
  assert.equal(storage.values.get(LEGACY_STORAGE_KEY), '{not json');
  const replacing = new LegacySessionController(storage);
  await replacing.resolve('', AT);
  replacing.commit(FOUND);
  assert.notEqual(storage.values.get(LEGACY_STORAGE_KEY), '{not json', 'raising a new banner replaces the unreadable record');
  assert.equal(replacing.info().kind, 'stored');
});

test('a browser that refuses storage keeps the visit in memory and says so', async () => {
  const controller = new LegacySessionController(null);
  const session = await controller.resolve('', AT);
  assert.equal(session.kind, 'unavailable');
  assert.equal(controller.canSave(), false);
  controller.commit(FOUND);
  assert.equal(controller.saveStatus, 'none');
  assert.equal(controller.info().saved, false);
});
