import { createServer } from "node:http";

// A real, valid GLB with a single triangle. Padding makes streamed progress
// observable without downloading or decoding the supplied character model.
export function tinyGlb({ textureUrl } = {}) {
  const positions = Buffer.from(new Float32Array([-.6, -1, 0, .6, -1, 0, 0, 1, 0]).buffer);
  const vertices = Buffer.concat([positions, Buffer.from(new Float32Array([0, 0, 1, 0, .5, 1]).buffer)]);
  const json = Buffer.from(JSON.stringify({
    asset: { version: "2.0", generator: "Crownfall loading verification fixture" }, scene: 0,
    scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [.6, .45, .15, 1], metallicFactor: .2, roughnessFactor: .5, ...(textureUrl ? { baseColorTexture: { index: 0 } } : {}) }, doubleSided: true }],
    ...(textureUrl ? { images: [{ uri: textureUrl }], textures: [{ source: 0 }] } : {}),
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-.6, -1, 0], max: [.6, 1, 0] }, { bufferView: 1, componentType: 5126, count: 3, type: "VEC2" }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length }, { buffer: 0, byteOffset: positions.length, byteLength: vertices.length - positions.length }], buffers: [{ byteLength: vertices.length }],
  }));
  const jsonLength = 128 * 1024;
  const body = Buffer.alloc(12 + 8 + jsonLength + 8 + vertices.length);
  body.writeUInt32LE(0x46546c67, 0); body.writeUInt32LE(2, 4); body.writeUInt32LE(body.length, 8);
  body.writeUInt32LE(jsonLength, 12); body.writeUInt32LE(0x4e4f534a, 16);
  body.fill(0x20, 20, 20 + jsonLength); json.copy(body, 20);
  body.writeUInt32LE(vertices.length, 20 + jsonLength); body.writeUInt32LE(0x004e4942, 24 + jsonLength);
  vertices.copy(body, 28 + jsonLength);
  return body;
}

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

export async function loadingFixtureServer() {
  const body = tinyGlb(), routes = new Map(), textures = new Map(), sockets = new Set();
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://fixture").pathname;
    const texture = textures.get(path);
    if (texture) {
      texture.textureStarted.resolve();
      await texture.texture.promise;
      response.writeHead(200, { "Access-Control-Allow-Origin": "*", "Content-Type": "image/png", "Cache-Control": "no-store" });
      response.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGO8c2LBfwYGBgYmBigAADKkA0dHWlSkAAAAAElFTkSuQmCC", "base64"));
      return;
    }
    const plan = routes.get(path);
    if (!plan) { response.writeHead(404); response.end("Unknown loading fixture"); return; }
    plan.requests++;
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "model/gltf-binary");
    if (plan.failed) {
      response.writeHead(404); response.end("Intentionally unavailable loading fixture");
      plan.started.resolve(); return;
    }
    const model = plan.body;
    if (plan.knownLength) response.setHeader("Content-Length", String(model.length));
    response.writeHead(200);
    const quarter = Math.floor(model.length / 4);
    response.write(model.subarray(0, quarter));
    plan.started.resolve();
    if (plan.hold) await plan.middle.promise;
    if (response.destroyed) return;
    response.write(model.subarray(quarter, quarter * 2));
    if (plan.hold) await plan.end.promise;
    if (!response.destroyed) response.end(model.subarray(quarter * 2));
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    bodyBytes: body.length,
    plan(name, { knownLength = true, hold = true, failed = false, texture = false } = {}) {
      const plan = { knownLength, hold, failed, requests: 0, started: deferred(), middle: deferred(), end: deferred(), textureStarted: deferred(), texture: deferred(), body: texture ? tinyGlb({ textureUrl: `${name}-texture.png` }) : body };
      routes.set(`/${name}.glb`, plan);
      if (texture) textures.set(`/${name}-texture.png`, plan);
      return Object.assign(plan, { url: `${base}/${name}.glb`, releaseMiddle: () => plan.middle.resolve(), releaseEnd: () => plan.end.resolve(), releaseTexture: () => plan.texture.resolve() });
    },
    async close() {
      for (const plan of routes.values()) { plan.middle.resolve(); plan.end.resolve(); plan.texture.resolve(); }
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
