// Chronicles test aggregator (docs/chronicles/ARCHITECTURE.md §2). The Quest
// `test` script runs this one file, so new Chronicles suites join here instead
// of in the shared package script. Run it alone with
//   cd main-game-vr && npx tsx --test ../shared/chronicles/chronicles.test.ts
import { existsSync } from "node:fs";
import "./content.test";
import "./status.test";
import "./scene-state.test";

// The archive suites (blueprint, kernel, materials and the relief) run through
// the environment owner's aggregator, archive/archive.test.ts. Until that file
// exists, the relief suite runs directly.
const archiveSuite = new URL("./archive/archive.test.ts", import.meta.url);
await import(existsSync(archiveSuite) ? archiveSuite.href : new URL("./archive/relief.test.ts", import.meta.url).href);
