// Discovers the Bannerhold environment built by the environment workflow
// (docs/legacy/WORKFLOWS.md). Its module is optional at build time: when
// ./environment/createLegacyEnvironment.ts is absent or fails, gameplay uses its
// own stand-in so My Legacy stays usable and honestly labelled.

import type { CreateQuestLegacyEnvironment, QuestLegacyEnvironment, QuestLegacyEnvironmentOptions } from './environment-contract.js';
import { createOwnedQuestEnvironment, createQuestEnvironmentOrFallback } from './environment-attempt.js';

type EnvironmentModule = { createLegacyEnvironment?: CreateQuestLegacyEnvironment };

const environmentModules = import.meta.glob<EnvironmentModule>('./environment/createLegacyEnvironment.ts');

export type QuestEnvironmentSource = 'environment' | 'standin';

export interface ProvidedQuestEnvironment {
  environment: QuestLegacyEnvironment;
  source: QuestEnvironmentSource;
  /** True when the environment module exists but could not be loaded or created. */
  fellBack: boolean;
}

async function createStandIn(options: QuestLegacyEnvironmentOptions): Promise<QuestLegacyEnvironment> {
  const { createStandInEnvironment } = await import('./standin/createStandInEnvironment.js');
  return createStandInEnvironment(options);
}

/** Creates the environment lazily: the Bannerhold when it is available, otherwise the stand-in. */
export async function provideQuestLegacyEnvironment(options: QuestLegacyEnvironmentOptions): Promise<ProvidedQuestEnvironment> {
  const load = Object.values(environmentModules)[0];
  if (load) {
    let create: CreateQuestLegacyEnvironment;
    try {
      const module = await load();
      if (typeof module.createLegacyEnvironment !== 'function') throw new Error('createLegacyEnvironment is not exported');
      create = module.createLegacyEnvironment;
    } catch (error) {
      console.warn('[My Legacy] The Bannerhold environment could not be created; using the stand-in.', error);
      return { environment: await createOwnedQuestEnvironment(options, createStandIn), source: 'standin', fellBack: true };
    }
    return createQuestEnvironmentOrFallback(options, create, createStandIn);
  }
  return { environment: await createOwnedQuestEnvironment(options, createStandIn), source: 'standin', fellBack: false };
}
