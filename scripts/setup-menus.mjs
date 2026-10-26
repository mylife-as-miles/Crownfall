import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || major === 20 && minor < 19) throw new Error('Use Node.js 20.19 or newer; Node 24 is recommended.');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const directory of ['main game', 'main-game-vr']) {
  execFileSync(npm, ['ci', '--no-audit', '--no-fund'], {
    cwd: resolve(root, directory), stdio: 'inherit',
    // The SDK reference helper uses CPU inference; its optional CUDA download
    // is not needed to build or run either Crownfall experience.
    env: { ...process.env, ONNXRUNTIME_NODE_INSTALL_CUDA: 'skip' },
  });
}
