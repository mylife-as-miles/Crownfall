import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D, PokeInteractable, RayInteractable, ShaderMaterial, Texture, TransformSystem, World } from '@iwsdk/core';
import type { Entity } from '@iwsdk/core';
import { presentBannerhold } from '../../../shared/legacy/domain/presentation';
import { createLegacyState } from '../../../shared/legacy/domain/state';
import { createOwnedQuestEnvironment, createQuestEnvironmentOrFallback } from './environment-attempt';
import type { QuestLegacyEnvironment, QuestLegacyEnvironmentOptions } from './environment-contract';
import { fallbackLegacyStaging } from './legacy-staging';

function setup() {
  const world = new World();
  world.registerSystem(TransformSystem);
  world.registerComponent(RayInteractable);
  world.registerComponent(PokeInteractable);
  const anchor = world.createTransformEntity(new Object3D());
  const panel = world.createTransformEntity(new Object3D(), { parent: anchor });
  panel.addComponent(RayInteractable);
  const options: QuestLegacyEnvironmentOptions = {
    world, parent: anchor, state: presentBannerhold(createLegacyState()), quality: 'low', posture: 'seated', reducedMotion: true,
    onLandmarkHover: () => {}, onLandmarkSelect: () => {},
  };
  return { world, anchor, panel, options };
}

function environment(dispose: () => void): QuestLegacyEnvironment {
  return {
    setState() {}, focusLandmark() {}, highlightLandmark() {}, update() {}, setQuality() {}, setPosture() {},
    setReducedMotion() {}, setVisible() {}, setPaused() {}, getLandmarks: () => [], getStaging: () => fallbackLegacyStaging('seated'),
    getStats: () => ({ triangles: 0, drawCalls: 0, geometries: 0, textures: 0, frameTimesMs: [] }), dispose,
  };
}

test('a failed factory rolls back partial GPU resources and ray/poke entities before fallback, preserving anchor siblings', async () => {
  const { world, anchor, panel, options } = setup();
  const geometry = new BoxGeometry(1, 1, 1);
  const texture = new Texture();
  const material = new MeshBasicMaterial({ map: texture });
  const counts = { geometry: 0, material: 0, texture: 0 };
  geometry.addEventListener('dispose', () => counts.geometry++);
  material.addEventListener('dispose', () => counts.material++);
  texture.addEventListener('dispose', () => counts.texture++);
  const partial: Entity[] = [];
  let failedParent: typeof anchor | undefined;
  let failedObject: Object3D | undefined;
  let failedGeneration = -1;
  let fallbackParent: typeof anchor | undefined;
  let ownerDisposals = 0;
  const result = await createQuestEnvironmentOrFallback(options, async ({ parent }) => {
    failedParent = parent;
    failedObject = parent.object3D;
    failedGeneration = parent.generation;
    const model = world.createTransformEntity(new Object3D(), { parent });
    partial.push(model);
    for (let index = 0; index < 2; index++) {
      const proxy = world.createTransformEntity(new Mesh(geometry, material), { parent: model });
      proxy.addComponent(RayInteractable);
      proxy.addComponent(PokeInteractable);
      partial.push(proxy);
    }
    model.object3D!.add(new Mesh(geometry, material));
    throw new Error('factory rejected after creating pick targets');
  }, async ({ parent }) => {
    // EliCS may reuse the just-released Entity instance for the fallback.
    // Its old generation/tree must be gone, even when the object is recycled.
    assert.ok(!failedParent?.active || failedParent.generation !== failedGeneration);
    assert.equal(failedObject?.parent, null);
    assert.ok(partial.every((entity) => !entity.active && world.entityManager.getEntityByIndex(entity.index) === null));
    assert.deepEqual(counts, { geometry: 1, material: 1, texture: 1 });
    assert.equal(panel.active, true);
    assert.equal(panel.hasComponent(RayInteractable), true);
    assert.equal(panel.object3D?.parent, anchor.object3D);
    fallbackParent = parent;
    return environment(() => { ownerDisposals++; });
  });
  assert.equal(result.source, 'standin'); assert.equal(result.fellBack, true);
  assert.notEqual(fallbackParent!.object3D, failedObject);
  assert.deepEqual(anchor.object3D!.children, [panel.object3D, fallbackParent!.object3D]);
  result.environment.dispose(); result.environment.dispose();
  assert.equal(ownerDisposals, 1);
  assert.equal(fallbackParent?.active, false);
  assert.deepEqual(anchor.object3D!.children, [panel.object3D]);
  panel.dispose(); anchor.dispose();
});

test('a successful owner disposes once and the attempt releases leftover child entities', async () => {
  const { world, anchor, panel, options } = setup();
  const geometry = new BoxGeometry(1, 1, 1);
  const material = new MeshBasicMaterial();
  let geometryDisposals = 0; let materialDisposals = 0; let ownerDisposals = 0;
  geometry.addEventListener('dispose', () => geometryDisposals++);
  material.addEventListener('dispose', () => materialDisposals++);
  let proxy: Entity | undefined;
  const owned = await createOwnedQuestEnvironment(options, async ({ parent }) => {
    const model = world.createTransformEntity(new Object3D(), { parent });
    proxy = world.createTransformEntity(new Mesh(geometry, material), { parent: model });
    proxy.addComponent(RayInteractable);
    return environment(() => { ownerDisposals++; model.dispose(); });
  });
  owned.dispose(); owned.dispose();
  assert.equal(ownerDisposals, 1);
  assert.equal(proxy?.active, false);
  assert.equal(geometryDisposals, 1); assert.equal(materialDisposals, 1);
  assert.deepEqual(anchor.object3D!.children, [panel.object3D]);
  panel.dispose(); anchor.dispose();
});

test('rollback preserves GPU resources already referenced by a live anchor sibling', async () => {
  const { world, anchor, panel, options } = setup();
  const geometry = new BoxGeometry(1, 1, 1);
  const texture = new Texture();
  const material = new MeshBasicMaterial({ map: texture });
  const sibling = world.createTransformEntity(new Mesh(geometry, material), { parent: anchor });
  let disposals = 0;
  for (const resource of [geometry, material, texture]) resource.addEventListener('dispose', () => disposals++);
  let child: Entity | undefined;
  await assert.rejects(createOwnedQuestEnvironment(options, async ({ parent }) => {
    child = world.createTransformEntity(new Mesh(geometry, material), { parent });
    child.addComponent(RayInteractable);
    throw new Error('partial model reuses existing resources');
  }), /reuses existing resources/);
  assert.equal(disposals, 0);
  assert.equal(child?.active, false);
  assert.equal(sibling.active, true);
  assert.equal(sibling.object3D?.parent, anchor.object3D);
  assert.deepEqual(anchor.object3D!.children, [panel.object3D, sibling.object3D]);
  sibling.dispose(); panel.dispose(); anchor.dispose();
  assert.equal(disposals, 3, 'the original owner, rather than the failed attempt, releases its three resources');
});

test('a late successful factory can be disposed without leaving active descendants', async () => {
  const { world, anchor, panel, options } = setup();
  let finish!: () => void;
  const ready = new Promise<void>((resolve) => { finish = resolve; });
  let child: Entity | undefined;
  let ownerDisposals = 0;
  const loading = createOwnedQuestEnvironment(options, async ({ parent }) => {
    await ready;
    child = world.createTransformEntity(new Object3D(), { parent });
    child.addComponent(PokeInteractable);
    return environment(() => { ownerDisposals++; });
  });
  // Models the host leaving while creation is pending, then disposing the
  // stale result in its existing ensureEnvironment completion guard.
  finish();
  const stale = await loading;
  stale.dispose(); stale.dispose();
  assert.equal(ownerDisposals, 1);
  assert.equal(child?.active, false);
  assert.deepEqual(anchor.object3D!.children, [panel.object3D]);
  panel.dispose(); anchor.dispose();
});

test('a rejected fallback also releases its attempted subtree', async () => {
  const { world, anchor, panel, options } = setup();
  let fallbackChild: typeof panel | undefined;
  await assert.rejects(createQuestEnvironmentOrFallback(options, async () => { throw new Error('primary unavailable'); }, async ({ parent }) => {
    fallbackChild = world.createTransformEntity(new Object3D(), { parent });
    fallbackChild.addComponent(RayInteractable);
    throw new Error('fallback failed too');
  }), /fallback failed too/);
  assert.equal(fallbackChild?.active, false);
  assert.deepEqual(anchor.object3D!.children, [panel.object3D]);
  panel.dispose(); anchor.dispose();
});

test('async rollback never follows a disposed attempt entity recycled for an unrelated owner', async () => {
  const { world, anchor, panel, options } = setup();
  let reject!: (reason: Error) => void;
  const pending = new Promise<QuestLegacyEnvironment>((_resolve, fail) => { reject = fail; });
  let attempt!: Entity;
  let child!: Entity;
  const loading = createOwnedQuestEnvironment(options, async ({ parent }) => {
    attempt = parent;
    child = world.createTransformEntity(new Object3D(), { parent });
    child.addComponent(RayInteractable);
    return pending;
  });
  const oldGeneration = attempt.generation;
  const oldObject = attempt.object3D!;
  attempt.dispose();
  const geometry = new BoxGeometry(1, 1, 1);
  const material = new MeshBasicMaterial();
  let disposals = 0;
  geometry.addEventListener('dispose', () => disposals++);
  material.addEventListener('dispose', () => disposals++);
  const unrelated = world.createTransformEntity(new Mesh(geometry, material), { parent: anchor });
  unrelated.addComponent(PokeInteractable);
  assert.equal(unrelated, attempt, 'the real SDK recycles the exact Entity instance');
  assert.notEqual(unrelated.generation, oldGeneration);
  reject(new Error('original factory failed late'));
  await assert.rejects(loading, /failed late/);
  assert.equal(child.active, false, 'the detached original tree loses its ghost ray target');
  assert.equal(oldObject.parent, null);
  assert.equal(unrelated.active, true);
  assert.equal(unrelated.hasComponent(PokeInteractable), true);
  assert.equal(unrelated.object3D?.parent, anchor.object3D);
  assert.equal(disposals, 0, 'the unrelated generation keeps its GPU resources');
  unrelated.dispose(); panel.dispose(); anchor.dispose();
  assert.equal(disposals, 2);
});

test('rollback releases shader uniform textures once and preserves borrowed sibling uniforms', async () => {
  const { world, anchor, panel, options } = setup();
  const borrowed = new Texture();
  const owned = new Texture();
  let borrowedDisposals = 0; let ownedDisposals = 0;
  borrowed.addEventListener('dispose', () => borrowedDisposals++);
  owned.addEventListener('dispose', () => ownedDisposals++);
  const siblingMaterial = new ShaderMaterial({ uniforms: { map: { value: borrowed } } });
  const sibling = world.createTransformEntity(new Mesh(new BoxGeometry(1, 1, 1), siblingMaterial), { parent: anchor });
  await assert.rejects(createOwnedQuestEnvironment(options, async ({ parent }) => {
    const material = new ShaderMaterial({ uniforms: { single: { value: owned }, many: { value: [owned, borrowed] } } });
    world.createTransformEntity(new Mesh(new BoxGeometry(1, 1, 1), material), { parent });
    throw new Error('shader factory failed');
  }), /shader factory failed/);
  assert.equal(ownedDisposals, 1);
  assert.equal(borrowedDisposals, 0);
  assert.equal(sibling.active, true);
  assert.equal(siblingMaterial.uniforms.map.value, borrowed);
  sibling.dispose(); panel.dispose(); anchor.dispose();
  // SDK's generic material disposal does not traverse custom uniforms; their
  // original shader owner explicitly releases this borrowed texture.
  borrowed.dispose();
  assert.equal(borrowedDisposals, 1);
});
