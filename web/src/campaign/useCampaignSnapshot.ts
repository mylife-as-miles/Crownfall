import { useSyncExternalStore } from "react";

import type { CampaignController } from "./campaignController";
import type { CampaignSnapshot } from "./types";

export function useCampaignSnapshot(controller: CampaignController): CampaignSnapshot {
  return useSyncExternalStore(
    (listener) => controller.on("state", listener),
    () => controller.getSnapshot(),
    () => controller.getSnapshot(),
  );
}
