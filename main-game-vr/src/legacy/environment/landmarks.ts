// Landmark selection on Quest: invisible pick spheres (the blueprint's pick volumes, 5.6–11.2 cm
// at 1:125) with RayInteractable and PokeInteractable, hover and select reported through the
// contract callbacks, and visible emphasis (a label that turns to face the viewer, a ring on the
// ground and the shared shader highlight). Nothing here ever moves the viewer.

import {
  AdditiveBlending, CanvasTexture, Color, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, PokeInteractable,
  RayInteractable, RingGeometry, SphereGeometry, SRGBColorSpace, Vector3,
} from '@iwsdk/core';
import type { Entity, Group, Object3D, World } from '@iwsdk/core';
import type { LandmarkId } from '../../../../shared/legacy/types';
import type { LandmarkBuild } from '../../../../shared/legacy/environment/build/buildBannerhold';
import type { TerrainField } from '../../../../shared/legacy/environment/kernel/mesh';
import { sampleField } from '../../../../shared/legacy/environment/kernel/mesh';
import type { MiniatureFrame } from '../../../../shared/legacy/environment/vr/frame';
import { blueprintToAnchor } from '../../../../shared/legacy/environment/vr/frame';
import { landmarkTargetName } from './constants';

const LABEL_SIZE: readonly [number, number] = [0.15, 0.0375];

interface LandmarkParts {
  id: LandmarkId;
  build: LandmarkBuild;
  proxy: Mesh;
  entity: Entity;
  label: Mesh;
  labelTexture: CanvasTexture;
  labelMaterial: MeshBasicMaterial;
  ring: Mesh;
  hovered: Set<number>;
  labelOpacity: number;
  onEnter: (event: { pointerId: number }) => void;
  onLeave: (event: { pointerId: number }) => void;
  onClick: () => void;
}

function drawLabel(text: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.clearRect(0, 0, 512, 128);
  const r = 26;
  g.beginPath();
  g.moveTo(r + 6, 6); g.lineTo(506 - r, 6); g.quadraticCurveTo(506, 6, 506, 6 + r); g.lineTo(506, 122 - r);
  g.quadraticCurveTo(506, 122, 506 - r, 122); g.lineTo(6 + r, 122); g.quadraticCurveTo(6, 122, 6, 122 - r); g.lineTo(6, 6 + r);
  g.quadraticCurveTo(6, 6, 6 + r, 6); g.closePath();
  g.fillStyle = 'rgba(18, 15, 10, 0.92)';
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = '#a07a3c';
  g.stroke();
  g.fillStyle = '#f0e6d2';
  g.font = '600 58px Barlow, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text.toUpperCase(), 256, 68, 470);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export interface LandmarkEmphasis {
  hover: LandmarkId | null;
  highlight: LandmarkId | null;
  focus: LandmarkId | null;
}

export class QuestLandmarks {
  private readonly parts: LandmarkParts[] = [];
  private readonly proxyGeometry = new SphereGeometry(1, 12, 8);
  private readonly proxyMaterial = new MeshBasicMaterial({ visible: false });
  private readonly labelGeometry = new PlaneGeometry(LABEL_SIZE[0], LABEL_SIZE[1]);
  private readonly ringGeometry = new RingGeometry(0.94, 1.0, 64, 1);
  private readonly hoverRing: MeshBasicMaterial;
  private readonly focusRing: MeshBasicMaterial;
  private readonly tmp = new Vector3();
  private readonly anchorPoint: [number, number, number] = [0, 0, 0];
  private interactive = false;
  private hoveredId: LandmarkId | null = null;
  private emphasis: LandmarkEmphasis = { hover: null, highlight: null, focus: null };

  constructor(
    world: World,
    miniatureEntity: Entity,
    private readonly labelParent: Group,
    content: Group,
    landmarks: readonly LandmarkBuild[],
    centre: readonly [number, number, number],
    field: TerrainField,
    private readonly onHover: (id: LandmarkId | null) => void,
    private readonly onSelect: (id: LandmarkId) => void,
    private readonly canSelect: () => boolean,
  ) {
    this.hoverRing = new MeshBasicMaterial({ color: new Color(1.0, 0.75, 0.42), transparent: true, opacity: 0.4, depthWrite: false, blending: AdditiveBlending, toneMapped: false, side: DoubleSide });
    this.focusRing = new MeshBasicMaterial({ color: new Color(1.0, 0.8, 0.5), transparent: true, opacity: 0.7, depthWrite: false, blending: AdditiveBlending, toneMapped: false, side: DoubleSide });
    for (const l of landmarks) {
      const proxy = new Mesh(this.proxyGeometry, this.proxyMaterial);
      proxy.name = landmarkTargetName(l.id);
      proxy.position.set(l.pickCenter[0] - centre[0], l.pickCenter[1] - centre[1], l.pickCenter[2] - centre[2]);
      proxy.scale.setScalar(l.pickRadius);
      const entity = world.createTransformEntity(proxy, { parent: miniatureEntity });
      const labelTexture = drawLabel(l.label);
      const labelMaterial = new MeshBasicMaterial({ map: labelTexture, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: DoubleSide });
      const label = new Mesh(this.labelGeometry, labelMaterial);
      label.name = `Label_${l.id}`;
      label.visible = false;
      label.renderOrder = 20;
      labelParent.add(label);
      const ring = new Mesh(this.ringGeometry, this.hoverRing);
      ring.name = `Ring_${l.id}`;
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(l.pickCenter[0], sampleField(field, l.pickCenter[0], l.pickCenter[2]) + 0.6, l.pickCenter[2]);
      ring.scale.setScalar(l.pickRadius * 1.05);
      ring.visible = false;
      ring.renderOrder = 10;
      content.add(ring);
      const parts: LandmarkParts = {
        id: l.id, build: l, proxy, entity, label, labelTexture, labelMaterial, ring, hovered: new Set<number>(), labelOpacity: 0,
        onEnter: (event) => { parts.hovered.add(event.pointerId); this.updateHover(); },
        onLeave: (event) => { parts.hovered.delete(event.pointerId); this.updateHover(); },
        onClick: () => { if (this.canSelect()) this.onSelect(l.id); },
      };
      proxy.addEventListener('pointerenter', parts.onEnter as never);
      proxy.addEventListener('pointerleave', parts.onLeave as never);
      proxy.addEventListener('click', parts.onClick as never);
      this.parts.push(parts);
    }
  }

  private updateHover(): void {
    let next: LandmarkId | null = null;
    for (const p of this.parts) if (p.hovered.size > 0) next = p.id;
    if (next === this.hoveredId) return;
    this.hoveredId = next;
    this.onHover(next);
  }

  get hovered(): LandmarkId | null {
    return this.hoveredId;
  }

  /** Hidden proxies leave the interactable lists, so no hover or press survives a hide. */
  setInteractive(on: boolean): void {
    if (this.interactive === on) return;
    this.interactive = on;
    for (const p of this.parts) {
      if (on) p.entity.addComponent(RayInteractable).addComponent(PokeInteractable);
      else p.entity.removeComponent(RayInteractable).removeComponent(PokeInteractable);
    }
    if (!on) {
      for (const p of this.parts) p.hovered.clear();
      this.updateHover();
    }
  }

  setEmphasis(e: LandmarkEmphasis): void {
    this.emphasis = e;
    for (const p of this.parts) {
      const focused = p.id === e.focus;
      const shown = focused || p.id === e.hover || p.id === e.highlight;
      p.ring.visible = shown;
      p.ring.material = focused ? this.focusRing : this.hoverRing;
      if (!focused) p.ring.scale.setScalar(p.build.pickRadius * 1.05);
      if (shown) p.label.visible = true;
    }
  }

  /** Shows every label and ring for one shader compile pass (labels stay fully transparent), then restores. */
  setPrecompile(on: boolean): void {
    for (const p of this.parts) {
      if (on) {
        p.label.visible = true;
        p.ring.visible = true;
      } else {
        p.label.visible = p.labelOpacity > 0.001;
        p.ring.visible = p.id === this.emphasis.focus || p.id === this.emphasis.hover || p.id === this.emphasis.highlight;
      }
    }
    // The focus ring material is compiled through one ring while precompiling.
    if (this.parts.length) this.parts[0].ring.material = on ? this.focusRing : this.parts[0].id === this.emphasis.focus ? this.focusRing : this.hoverRing;
  }

  /** Places labels above their landmarks in anchor space for the current frame (posture/rotation). */
  layout(f: MiniatureFrame): void {
    for (const p of this.parts) {
      const a = p.build.anchor;
      blueprintToAnchor(f, a[0], a[1], a[2], this.anchorPoint);
      p.label.position.set(this.anchorPoint[0], this.anchorPoint[1] + 0.045, this.anchorPoint[2]);
    }
  }

  /** Per frame, allocation-free: fades labels and turns them toward the eye (`eye` in the label parent's space). */
  update(eye: Vector3, delta: number, time: number, reduced: boolean): void {
    const e = this.emphasis;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      const target = p.id === e.focus || p.id === e.hover || p.id === e.highlight ? 1 : 0;
      if (p.labelOpacity !== target) {
        const step = reduced ? 1 : Math.min(1, delta * 6);
        p.labelOpacity += (target - p.labelOpacity) * step;
        if (Math.abs(target - p.labelOpacity) < 0.02) p.labelOpacity = target;
        p.labelMaterial.opacity = p.labelOpacity;
        p.label.visible = p.labelOpacity > 0.001;
      }
      if (p.label.visible) {
        const dx = eye.x - p.label.position.x, dy = eye.y - p.label.position.y, dz = eye.z - p.label.position.z;
        p.label.rotation.set(Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)) * -1, Math.atan2(dx, dz), 0, 'YXZ');
      }
      if (p.id === e.focus && p.ring.visible) p.ring.scale.setScalar(p.build.pickRadius * (1.05 + (reduced ? 0 : Math.sin(time * 2.4) * 0.04)));
    }
  }

  /** Anchor-space positions for staging (pick centres), written into `out` entries in landmark order. */
  forEach(fn: (id: LandmarkId, build: LandmarkBuild, proxy: Object3D) => void): void {
    for (const p of this.parts) fn(p.id, p.build, p.proxy);
  }

  dispose(): void {
    for (const p of this.parts) {
      p.proxy.removeEventListener('pointerenter', p.onEnter as never);
      p.proxy.removeEventListener('pointerleave', p.onLeave as never);
      p.proxy.removeEventListener('click', p.onClick as never);
      p.entity.dispose({ disposeResources: false });
      p.label.removeFromParent();
      p.ring.removeFromParent();
      p.labelTexture.dispose();
      p.labelMaterial.dispose();
    }
    this.parts.length = 0;
    this.proxyGeometry.dispose();
    this.proxyMaterial.dispose();
    this.labelGeometry.dispose();
    this.ringGeometry.dispose();
    this.hoverRing.dispose();
    this.focusRing.dispose();
    this.labelParent.updateMatrixWorld();
  }
}
