// A failed environment has no returned owner to dispose it. Keep each attempt
// under its own entity so rollback cannot touch the reading panel or touch tray.
import type { BufferGeometry, Entity, Material, Object3D, Texture, World } from '@iwsdk/core';
import type { CreateQuestLegacyEnvironment, QuestLegacyEnvironment, QuestLegacyEnvironmentOptions } from './environment-contract.js';

type RenderObject = Object3D & { geometry?: BufferGeometry; material?: Material | Material[]; entityIdx?: number };
interface Resources { geometries: Set<BufferGeometry>; materials: Set<Material>; textures: Set<Texture> }
interface EntityOwner { entity: Entity; generation: number; object: Object3D }
interface OwnedTree extends Resources { entities: EntityOwner[] }
const resources = (): Resources => ({ geometries: new Set(), materials: new Set(), textures: new Set() });

function collectResources(object: RenderObject, into: Resources): void {
  if (object.geometry) into.geometries.add(object.geometry);
  const used = object.material ? Array.isArray(object.material) ? object.material : [object.material] : [];
  for (const material of used) {
    into.materials.add(material);
    const textureValue = (value: unknown): void => {
      if (value && typeof value === 'object' && 'isTexture' in value && value.isTexture === true) into.textures.add(value as Texture);
    };
    for (const value of Object.values(material)) textureValue(value);
    // ShaderMaterial textures live in uniform.value, sometimes as a flat
    // texture array. Deliberately do not walk arbitrary user object graphs.
    const uniforms = (material as Material & { uniforms?: Record<string, { value?: unknown }> }).uniforms;
    if (uniforms && typeof uniforms === 'object') for (const uniform of Object.values(uniforms)) {
      if (!uniform || typeof uniform !== 'object') continue;
      if (Array.isArray(uniform.value)) for (const value of uniform.value) textureValue(value);
      else textureValue(uniform.value);
    }
  }
}

function currentOwner(owner: EntityOwner): boolean {
  return owner.entity.active && owner.entity.generation === owner.generation && owner.entity.object3D === owner.object;
}

function captureTree(world: World, parent: EntityOwner): OwnedTree {
  const tree: OwnedTree = { ...resources(), entities: [] };
  const collect = (object: RenderObject, assetOwned: boolean): void => {
    const owner = typeof object.entityIdx === 'number' ? world.entityManager.getEntityByIndex(object.entityIdx) : null;
    if (owner?.object3D === object && owner.active) tree.entities.push({ entity: owner, generation: owner.generation, object });
    const ownsAsset = assetOwned || typeof object.userData.iwsdkDisposeAsset === 'function';
    // Loader assets and runtime-only resources retain their existing owners.
    if (!ownsAsset && object.userData.iwsdkRuntimeOnly !== true) collectResources(object, tree);
    for (const child of object.children) collect(child, ownsAsset);
  };
  // Never follow a recycled parent's current object3D after an async factory.
  // The detached original tree may still contain descendant ECS entities.
  collect(parent.object, false);
  if (currentOwner(parent) && !tree.entities.some((owner) => owner.entity === parent.entity)) {
    tree.entities.unshift(parent);
  }
  return tree;
}

/**
 * Entity.dispose() releases one ECS entity, not its descendants. Snapshot these
 * before an owner's dispose removes their Object3D tree, and release any still
 * active descendants without a second GPU disposal. On failed creation only,
 * this boundary also releases attached, attempt-owned resources exactly once.
 */
function releaseTree(tree: OwnedTree, protectedResources: Resources, disposeResources: boolean): void {
  const errors: unknown[] = [];
  const release = (dispose: () => void): void => { try { dispose(); } catch (error) { errors.push(error); } };
  if (disposeResources) {
    for (const texture of tree.textures) if (!protectedResources.textures.has(texture)) release(() => texture.dispose());
    for (const material of tree.materials) if (!protectedResources.materials.has(material)) release(() => material.dispose());
    for (const geometry of tree.geometries) if (!protectedResources.geometries.has(geometry)) release(() => geometry.dispose());
  }
  for (let index = tree.entities.length - 1; index >= 0; index--) {
    const { entity, generation, object } = tree.entities[index];
    // EliCS recycles Entity instances; never release a different generation.
    if (entity.active && entity.generation === generation && entity.object3D === object) {
      release(() => entity.dispose({ disposeResources: false }));
    }
  }
  if (errors.length) console.warn('[My Legacy] Environment rollback encountered disposal errors.', errors);
}

/** Creates an isolated attempt; its returned owner also releases the container. */
export async function createOwnedQuestEnvironment(options: QuestLegacyEnvironmentOptions, create: CreateQuestLegacyEnvironment): Promise<QuestLegacyEnvironment> {
  const protectedResources = resources();
  // A factory may reuse a resource already shown by an anchor sibling. Such a
  // resource remains live after rollback and must not be disposed here.
  options.parent.object3D?.traverse((object) => collectResources(object, protectedResources));
  const parent = options.world.createTransformEntity(undefined, { parent: options.parent });
  const owner: EntityOwner = { entity: parent, generation: parent.generation, object: parent.object3D! };
  owner.object.name = 'My Legacy Environment Attempt';
  try {
    const environment = await create({ ...options, parent });
    const dispose = environment.dispose.bind(environment);
    let disposed = false;
    environment.dispose = () => {
      if (disposed) return;
      disposed = true;
      const tree = captureTree(options.world, owner);
      try {
        // A stale owner may now be a different, unrelated entity. Its normal
        // disposer must not follow that recycled Entity reference either.
        if (currentOwner(owner)) dispose();
      } finally {
        // The returned environment owns normal GPU teardown. This adapter only
        // removes any ECS descendants it missed and the empty attempt entity.
        releaseTree(tree, protectedResources, false);
      }
    };
    return environment;
  } catch (error) {
    // If external teardown already released the root, it owned GPU disposal;
    // only detach its remaining old-generation ECS descendants here.
    releaseTree(captureTree(options.world, owner), protectedResources, currentOwner(owner));
    throw error;
  }
}

/** Roll back a rejected factory before constructing the fallback under a new owner. */
export async function createQuestEnvironmentOrFallback(options: QuestLegacyEnvironmentOptions, preferred: CreateQuestLegacyEnvironment, fallback: CreateQuestLegacyEnvironment): Promise<{ environment: QuestLegacyEnvironment; source: 'environment' | 'standin'; fellBack: boolean }> {
  try {
    return { environment: await createOwnedQuestEnvironment(options, preferred), source: 'environment', fellBack: false };
  } catch (error) {
    console.warn('[My Legacy] The Bannerhold environment could not be created; using the stand-in.', error);
    return { environment: await createOwnedQuestEnvironment(options, fallback), source: 'standin', fellBack: true };
  }
}
