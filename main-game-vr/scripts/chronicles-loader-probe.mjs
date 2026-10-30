// One-shot map-loader fault preparation for bounded native recovery checks.
// From the app: CROWNFALL_MAP_PROBE=arm ./node_modules/.bin/iwsdk browser run scripts/chronicles-loader-probe.mjs
// Use status/restore for the matching readback and cleanup. Let each callback
// return before CLI hand input; this rejects a loader call, not a network request.
export default async function run({ frame }) {
  if (!frame) throw new Error('The managed application frame is required');
  const action = process.env.CROWNFALL_MAP_PROBE || 'status';
  if (!['arm', 'status', 'restore'].includes(action)) throw new Error('Unknown map probe action');
  return frame.evaluate(async (action) => {
    const key = '__crownfallChroniclesMapProbe';
    const previous = globalThis[key];
    if (action === 'status') return previous?.status() ?? { installed: false };
    if (action === 'restore') return previous?.restore() ?? { installed: false, restored: true };
    previous?.restore();

    // Resolve the exact core module already used by the transformed app source.
    // Fetching the source text does not import the archive or change its code.
    const source = await fetch(new URL('src/chronicles/scene/atlas-diorama.ts', document.baseURI));
    if (!source.ok) throw new Error(`Diorama source unavailable (${source.status})`);
    const transformed = await source.text();
    const match = /import\s*\{[^}]*\bAssetManager\b[^}]*\}\s*from\s*["']([^"']+)["']/u.exec(transformed);
    if (!match) throw new Error('Could not resolve the app source AssetManager import');
    const moduleUrl = new URL(match[1], source.url).href;
    const { AssetManager } = await import(moduleUrl);
    if (typeof AssetManager?.loadTextureById !== 'function') throw new Error('Map loader seam unavailable');
    const original = AssetManager.loadTextureById;
    const probe = {
      token: `chronicles-map-${Date.now()}`,
      active: true, armed: true, calls: 0, rejected: 0, delegated: 0, successes: 0, delegatedRejections: 0,
      events: [], moduleUrl,
      status() {
        return {
          installed: true, kind: 'one-shot loader rejection; not a network failure',
          token: this.token, active: this.active, armed: this.armed, calls: this.calls,
          rejected: this.rejected, delegated: this.delegated, successes: this.successes,
          delegatedRejections: this.delegatedRejections, events: this.events, moduleUrl: this.moduleUrl,
        };
      },
      restore() {
        if (AssetManager.loadTextureById === injected) AssetManager.loadTextureById = original;
        this.active = false; this.armed = false;
        return { ...this.status(), restored: AssetManager.loadTextureById === original };
      },
    };
    function injected(id, ...args) {
      if (id !== 'chronicles-map') return original.call(this, id, ...args);
      probe.calls++;
      if (probe.armed) {
        probe.armed = false; probe.rejected++;
        probe.events.push({ at: Date.now(), outcome: 'injected-loader-rejection', id });
        const error = new Error('Injected one-shot Chronicles map loader rejection');
        error.name = 'ChroniclesLoaderProbeError';
        return Promise.reject(error);
      }
      probe.delegated++;
      return original.call(this, id, ...args).then((value) => {
        probe.successes++;
        probe.events.push({ at: Date.now(), outcome: 'original-loader-resolved', id });
        return value;
      }, (error) => {
        probe.delegatedRejections++;
        probe.events.push({ at: Date.now(), outcome: 'original-loader-rejected', id });
        throw error;
      });
    }
    AssetManager.loadTextureById = injected;
    globalThis[key] = probe;
    return probe.status();
  }, action);
}
