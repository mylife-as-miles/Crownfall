// Seam implementation (docs/legacy/WORKFLOWS.md): gameplay's Quest environment provider
// discovers this module with import.meta.glob and calls createLegacyEnvironment. A failure
// here rejects, so the provider falls back to its labelled stand-in.

import type { CreateQuestLegacyEnvironment } from '../environment-contract';
import { QuestBannerholdEnvironment } from './environment';

export const createLegacyEnvironment: CreateQuestLegacyEnvironment = async (options) => {
  const env = new QuestBannerholdEnvironment(options);
  try {
    await env.init();
  } catch (error) {
    env.dispose();
    throw error;
  }
  return env;
};
