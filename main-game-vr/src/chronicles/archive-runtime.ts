// The archive's lazy chunk: the room, the Living Atlas relief it sculpts, the
// blueprint and the control-surface pose. The menu loads it on the first visit
// to Chronicles, so none of it adds to the menu's launch.
import type { World } from '@iwsdk/core';
import type { ArchiveRoom, ArchiveRoomEvents } from './archive-controller.js';
import { MonumentRoom } from './monument-room.js';

export { chroniclesPanelPose } from './control-surface.js';

/** The Quest archive room. Until the environment owner's archive room lands, the monument stands alone. */
export function createArchiveRoom(world: World, events: ArchiveRoomEvents): ArchiveRoom {
  return new MonumentRoom(world, events);
}
