// Aggregator for the archive tests (relief, blueprint, kernel, materials), so the
// shared Quest test script lists Chronicles once. Run on its own with
//   cd main-game-vr && npx tsx --test ../shared/chronicles/archive/archive.test.ts
import "./relief.test";
import "./blueprint.test";
import "./kernel/kernel.test";
import "./materials.test";
