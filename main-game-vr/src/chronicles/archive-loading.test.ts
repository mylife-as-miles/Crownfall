import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { AssetManager, Group, Texture } from '@iwsdk/core';
import type { Entity, Object3D, UIKitMLAsset, World } from '@iwsdk/core';
import { getOpenEntry } from '../../../shared/chronicles/scene-state';
import { CHRONICLES_CONTENT_POLICY, CHRONICLES_LOAD_FAILURE, getChroniclesLoadFailure } from '../../../shared/chronicles/status';
import { createQuestState, reduceQuestState } from '../quest-state';
import type { QuestEvent } from '../quest-state';
import { QUEST_CHRONICLE_IDS } from '../ui-contract';
import { ArchiveController } from './archive-controller';
import type { ArchiveView } from './archive-controller';
import { ChroniclesArchiveState } from './archive-state';
import { MonumentRoom } from './monument-room';
import { AtlasDiorama } from './scene/atlas-diorama';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function entity(object: Object3D = new Group()): Entity {
  const components = new Set<unknown>();
  const values = new Map<string, unknown>();
  return {
    object3D: object,
    addComponent(component: unknown) { components.add(component); return this; },
    hasComponent(component: unknown) { return components.has(component); },
    setValue(_component: unknown, key: string, value: unknown) { values.set(key, value); },
    getValue(_component: unknown, key: string) { return values.get(key); },
    dispose() { object.removeFromParent(); },
  } as unknown as Entity;
}

// No renderer or managed session: exercise the real loader, room and controller
// with only their GPU upload and entity/panel boundaries replaced.
function fixture(upload: (texture: Texture) => void = () => {}) {
  const scene = new Group();
  const world = {
    renderer: { capabilities: { getMaxAnisotropy: () => 4 }, initTexture: upload },
    registerComponent() {},
    createTransformEntity(object: Object3D, options?: { parent?: Entity }) {
      (options?.parent?.object3D || scene).add(object);
      return entity(object);
    },
  } as unknown as World;
  const stateEntity = entity();
  const styles = new Map<string, Record<string, unknown>>();
  const panel = {
    getElementById(id: string) {
      return { setProperties(next: Record<string, unknown>) { styles.set(id, { ...styles.get(id), ...next }); } };
    },
  } as unknown as UIKitMLAsset;
  let state = reduceQuestState(createQuestState(), { type: 'home', panel: 'chronicles' });
  const reports: string[] = [];
  const view = (): ArchiveView => ({
    open: state.screen === 'chronicles' || state.paused && state.previousScreen === 'chronicles',
    shown: state.screen === 'chronicles', scene: state.chronicles,
    posture: 'seated', textScale: 100, quality: 'medium', motion: false,
  });
  const controller = new ArchiveController({
    world, stateEntity, panel, anchor: new Group(), panelObject: new Group(), view: new Group(),
    select: (id) => dispatch({ type: 'record', id }),
    ground: (x, y) => dispatch({ type: 'map', x, y }),
    loaded(result) { reports.push(result); dispatch({ type: 'loaded', result }); },
  }, (world, events) => new MonumentRoom(world, events));
  function dispatch(event: QuestEvent) {
    state = reduceQuestState(state, event);
    controller.sync(view());
  }
  controller.sync(view());
  return {
    world, scene, stateEntity, styles, reports, controller, dispatch,
    state: () => state,
    tick: () => controller.update(1 / 60, false),
  };
}

async function until(tick: () => void, condition: () => boolean) {
  for (let frame = 0; frame < 300; frame++) {
    tick();
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (condition()) return;
  }
  assert.fail('the archive did not reach the expected state');
}

test('a rejected map load ends loading, leaves records and Back usable, and retries on re-entry', async () => {
  const requests: ReturnType<typeof deferred<Texture>>[] = [];
  const loader = mock.method(AssetManager, 'loadTextureById', () => {
    const request = deferred<Texture>(); requests.push(request); return request.promise;
  });
  const app = fixture();
  try {
    await until(app.tick, () => requests.length === 1);
    assert.equal(app.state().chronicles.load, 'loading');
    assert.equal(getChroniclesLoadFailure(app.state().chronicles.load), null);
    assert.equal(app.stateEntity.getValue(ChroniclesArchiveState, 'loading'), true);
    requests[0].reject(new Error('map unavailable'));
    await until(app.tick, () => app.state().chronicles.load === 'failed');
    assert.deepEqual(app.reports, ['failed']);
    assert.equal(app.styles.get(QUEST_CHRONICLE_IDS.loading)?.display, 'none');
    assert.equal(app.stateEntity.getValue(ChroniclesArchiveState, 'loading'), false);
    assert.equal(getChroniclesLoadFailure(app.state().chronicles.load), CHRONICLES_LOAD_FAILURE);
    assert.equal(app.styles.get(QUEST_CHRONICLE_IDS.failure)?.display, 'flex');
    app.dispatch({ type: 'exhibit', exhibit: 'interregnum' });
    app.dispatch({ type: 'record', id: 'year-19' });
    assert.equal(getOpenEntry(app.state().chronicles, CHRONICLES_CONTENT_POLICY)?.id, 'year-19');
    app.dispatch({ type: 'back' });
    assert.equal(app.state().chronicles.entryId, null);
    app.dispatch({ type: 'back' });
    assert.equal(app.state().screen, 'home');
    assert.equal(app.styles.get(QUEST_CHRONICLE_IDS.failure)?.display, 'none');
    app.dispatch({ type: 'home', panel: 'chronicles' });
    await until(app.tick, () => requests.length === 2);
    assert.equal(app.state().chronicles.load, 'loading');
    requests[1].resolve(new Texture());
    await until(app.tick, () => app.state().chronicles.load === 'ready');
    assert.deepEqual(app.reports, ['failed', 'ready']);
    assert.equal(getChroniclesLoadFailure(app.state().chronicles.load), null);
    assert.equal(app.styles.get(QUEST_CHRONICLE_IDS.failure)?.display, 'none');
    assert.equal(app.stateEntity.getValue(ChroniclesArchiveState, 'loading'), false);
  } finally { app.controller.dispose(); loader.mock.restore(); }
});

test('a late rejection from a closed visit cannot fail the next visit', async () => {
  const first = deferred<Texture>(), second = deferred<Texture>();
  let calls = 0;
  const loader = mock.method(AssetManager, 'loadTextureById', () => (++calls === 1 ? first : second).promise);
  const app = fixture();
  try {
    await until(app.tick, () => calls === 1);
    app.dispatch({ type: 'back' });
    assert.equal(app.state().screen, 'home');
    app.dispatch({ type: 'home', panel: 'chronicles' });
    await until(app.tick, () => calls === 2);
    first.reject(new Error('old request failed'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    app.tick();
    assert.equal(app.state().chronicles.load, 'loading');
    assert.deepEqual(app.reports, []);
    second.resolve(new Texture());
    await until(app.tick, () => app.state().chronicles.load === 'ready');
    assert.deepEqual(app.reports, ['ready']);
  } finally { app.controller.dispose(); loader.mock.restore(); }
});

for (const action of ['close', 'dispose'] as const) {
  test(`a texture resolving after ${action} cannot restore the old diorama`, async () => {
    const request = deferred<Texture>();
    const loader = mock.method(AssetManager, 'loadTextureById', () => request.promise);
    let uploads = 0;
    const app = fixture(() => uploads++);
    const diorama = new AtlasDiorama(app.world, entity(), { select() {}, ground() {} });
    try {
      diorama.open(); diorama.update(1 / 60, false);
      diorama[action]();
      const texture = new Texture();
      request.resolve(texture);
      await new Promise<void>((resolve) => setImmediate(resolve));
      diorama.update(1 / 60, false);
      assert.equal(diorama.ready, false);
      assert.equal(diorama.failed, false);
      assert.equal(diorama.object, null);
      assert.equal(texture.anisotropy, 1, 'the obsolete callback never configures the cached texture');
      assert.equal(uploads, 0);
    } finally { diorama.dispose(); app.controller.dispose(); loader.mock.restore(); }
  });
}

test('an upload error reports failure, cleans partial geometry and can recover', async () => {
  const loader = mock.method(AssetManager, 'loadTextureById', async () => new Texture());
  let uploads = 0;
  const app = fixture(() => { if (++uploads === 1) throw new Error('upload failed'); });
  try {
    await until(app.tick, () => app.state().chronicles.load === 'failed');
    assert.deepEqual(app.reports, ['failed'], 'ready is never reported before the upload succeeds');
    assert.equal(app.scene.children.length, 1, 'only the empty room anchor remains');
    assert.equal(app.scene.children[0].children.length, 0, 'partial geometry is released');
    app.dispatch({ type: 'back' });
    app.dispatch({ type: 'home', panel: 'chronicles' });
    await until(app.tick, () => app.state().chronicles.load === 'ready');
    assert.equal(uploads, 2);
    assert.deepEqual(app.reports, ['failed', 'ready']);
  } finally { app.controller.dispose(); loader.mock.restore(); }
});

test('a synchronous texture-loader error ends loading instead of escaping update', async () => {
  const loader = mock.method(AssetManager, 'loadTextureById', () => { throw new Error('loader failed'); });
  const app = fixture();
  try {
    await until(app.tick, () => app.state().chronicles.load === 'failed');
    assert.deepEqual(app.reports, ['failed']);
    assert.equal(app.stateEntity.getValue(ChroniclesArchiveState, 'loading'), false);
  } finally { app.controller.dispose(); loader.mock.restore(); }
});
