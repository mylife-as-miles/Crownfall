import { Mesh, MeshBasicMaterial, Object3D, Points, ShaderMaterial, Vector4 } from '@iwsdk/core';

export type AtmosphereQuality = 'low' | 'medium' | 'high';
type Surface = Mesh | Points;

/** Wrap a placed manifest clone; only this instance's shader materials are owned. */
export class CrownfallAtmosphere {
  private readonly surfaces: Surface[] = [];
  private readonly originals: ShaderMaterial[] = [];
  private readonly materials: ShaderMaterial[] = [];
  private readonly viewport = new Vector4();
  private readonly medium: Points;
  private readonly high: Points;
  private readonly aura: Mesh;
  private readonly veil: Mesh;
  private readonly veilOriginal: MeshBasicMaterial;
  private readonly veilMaterial: MeshBasicMaterial;
  private previousTime = Number.NaN;
  private activeTime = 0;

  constructor(readonly object: Object3D) {
    this.medium = object.getObjectByName('Desktop Motes medium') as Points;
    this.high = object.getObjectByName('Desktop Motes high') as Points;
    this.aura = object.getObjectByName('Desktop Spirit Aura') as Mesh;
    this.veil = object.getObjectByName('Desktop Scene Veil') as Mesh;
    if (!this.medium || !this.high || !this.aura || !this.veil) throw new Error('Crownfall atmosphere manifest asset is incomplete.');
    this.veilOriginal = this.veil.material as MeshBasicMaterial;
    this.veilMaterial = this.veilOriginal.clone();
    this.veil.material = this.veilMaterial;
    const clones = new Map<ShaderMaterial, ShaderMaterial>();
    object.traverse(child => {
      if (!(child instanceof Mesh || child instanceof Points)) return;
      const original = child.material;
      if (!(original instanceof ShaderMaterial)) return;
      let material = clones.get(original);
      if (!material) {
        material = original.clone(); clones.set(original, material);
        this.materials.push(material);
      }
      this.surfaces.push(child); this.originals.push(original); child.material = material;
    });
    const beforeMotesRender: Points['onBeforeRender'] = renderer => {
      renderer.getCurrentViewport(this.viewport);
      (this.medium.material as ShaderMaterial).uniforms.uViewportHeight.value = Math.max(1, this.viewport.w);
    };
    this.medium.onBeforeRender = beforeMotesRender;
    this.high.onBeforeRender = beforeMotesRender;
  }

  /** Pass elapsed seconds. Paused/motion-off time is excluded, with no catch-up jump. */
  update(time: number, motion: boolean, paused: boolean, quality: AtmosphereQuality, dim = 0, color = 0x0a0805): void {
    if (Number.isFinite(time)) {
      if (Number.isFinite(this.previousTime) && motion && !paused) this.activeTime += Math.max(0, time - this.previousTime);
      this.previousTime = time;
    }
    const amount = Math.max(0, Math.min(1, dim));
    for (let i = 0; i < this.materials.length; i++) {
      const uniforms = this.materials[i].uniforms;
      uniforms.uTime.value = this.activeTime;
      uniforms.uDim.value = 0;
    }
    this.medium.visible = quality === 'medium';
    this.high.visible = quality === 'high';
    this.aura.visible = quality !== 'low';
    this.veil.visible = amount > 0;
    this.veilMaterial.opacity = amount;
    this.veilMaterial.color.setHex(color);
    if (Number.isFinite(this.object.scale.z) && this.object.scale.z !== 0) this.veil.position.z = .83 / this.object.scale.z;
  }

  dispose(): void {
    this.veil.material = this.veilOriginal;
    this.veilMaterial.dispose();
    for (let i = 0; i < this.surfaces.length; i++) this.surfaces[i].material = this.originals[i];
    for (let i = 0; i < this.materials.length; i++) this.materials[i].dispose();
    this.materials.length = 0;
  }
}
