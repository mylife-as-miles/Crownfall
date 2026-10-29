import { Group, Mesh } from '@iwsdk/core';
import type { Entity, World } from '@iwsdk/core';
import { CHRONICLES_MAP } from '../../../shared/chronicles/content';
import type { ChronicleCollectionId } from '../../../shared/chronicles/types';
import type { ArchiveQualityPreset, ArchiveRoom, ArchiveRoomEvents, ArchiveRoomPose } from './archive-controller.js';
import { AtlasDiorama } from './scene/atlas-diorama.js';

/**
 * The interim archive room: the Living Atlas monument alone, as the Quest
 * diorama, until the environment owner's archive room
 * (main-game-vr/src/chronicles/scene/archive-room.ts) implements the same
 * ArchiveRoom contract. It is placed from the recentred head pose like the
 * full room, keeps the diorama's sliced build, reveal, markers and ground
 * stand-in, and has no light emphasis of its own: the markers answer only on
 * the Atlas.
 */
export class MonumentRoom implements ArchiveRoom {
  private readonly root: Entity;
  private readonly diorama: AtlasDiorama;

  constructor(world: World, events: ArchiveRoomEvents) {
    const group = new Group();
    group.name = 'Chronicles_Monument_Room';
    this.root = world.createTransformEntity(group);
    this.diorama = new AtlasDiorama(world, this.root, { select: events.select, ground: events.ground });
  }

  get ready(): boolean { return this.diorama.ready; }
  /** The diorama does not report partial progress, so the loading bar sweeps until it is ready. */
  get progress(): number { return this.diorama.ready ? 1 : 0; }

  open(): void { this.diorama.open(); }
  close(): void { this.diorama.close(); }
  setVisible(visible: boolean): void { this.diorama.setVisible(visible); }

  place(pose: ArchiveRoomPose): void {
    const object = this.root.object3D!;
    object.position.set(pose.head[0], pose.head[1], pose.head[2]);
    object.rotation.set(0, pose.yaw, 0);
    // The panel stands beside the monument, so no footer line constrains the
    // terrain: sea level sits at the posture's drop below the eye.
    this.diorama.place(pose.posture, 0, 1);
  }

  setCollection(_collection: ChronicleCollectionId): void { /* Light emphasis belongs to the archive room. */ }
  setSelection(recordId: string | null, atlasActive: boolean): void { this.diorama.setSelection(recordId, atlasActive); }
  setQuality(_quality: ArchiveQualityPreset): void { /* The diorama has one Quest tessellation. */ }
  update(delta: number, motion: boolean): void { this.diorama.update(delta, motion); }

  /** Visible triangles and the painting's estimated GPU bytes (4 per texel, mipmaps counted). Not for per-frame use. */
  stats(): { triangles: number; textureBytes: number } {
    let triangles = 0;
    this.root.object3D!.traverseVisible((child) => {
      if (!(child instanceof Mesh) || !child.geometry) return;
      const material = child.material;
      if (!Array.isArray(material) && material && material.visible === false) return;
      const index = child.geometry.index, position = child.geometry.getAttribute('position');
      triangles += Math.floor((index ? index.count : position ? position.count : 0) / 3);
    });
    return { triangles, textureBytes: this.diorama.ready ? Math.round(CHRONICLES_MAP.width * CHRONICLES_MAP.height * 4 * 4 / 3) : 0 };
  }

  dispose(): void {
    this.diorama.dispose();
    this.root.dispose();
  }
}
