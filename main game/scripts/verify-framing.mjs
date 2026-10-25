import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const directory = "artifacts/creature-height";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
// This code exists only in the intercepted development module for this test.
// No debug globals or instrumentation are written into production source.
const instrumentation = String.raw`
          const framingMeshes = [];
          model.traverse((object) => {
            if (!object.isSkinnedMesh) return;
            const positions = object.geometry.getAttribute("position");
            const joints = object.geometry.getAttribute("skinIndex");
            const weights = object.geometry.getAttribute("skinWeight");
            const headIndex = object.skeleton.bones.findIndex((bone) => /Head$/.test(bone.name));
            const selectedVertices = [];
            const counts = { crown: 0, face: 0, eye: 0 };
            for (let index = 0; index < positions.count; index++) {
              const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
              let headWeight = 0;
              for (let slot = 0; slot < 4; slot++) if (joints.getComponent(index, slot) === headIndex) headWeight += weights.getComponent(index, slot);
              const crown = y >= 0.94;
              const face = headWeight > 0.5 && y >= 0.80 && y <= 0.90 && Math.abs(x) < 0.085 && z > 0.045;
              const eye = headWeight > 0.5 && y >= 0.81 && y <= 0.865 && Math.abs(x) < 0.045 && z > 0.065;
              if (!crown && !face && !eye) continue;
              if (crown) counts.crown++;
              if (face) counts.face++;
              if (eye) counts.eye++;
              selectedVertices.push({ index, crown, face, eye });
            }
            framingMeshes.push({ object, selectedVertices, counts, headIndex });
          });
          window.__framingSetup = () => {
            const times = [...new Set([0, idle.duration, ...idle.tracks.flatMap((track) => Array.from(track.times))].map((time) => Math.round(time * 1000000) / 1000000))].sort((a, b) => a - b);
            return { duration: idle.duration, authoredTimes: times, counts: framingMeshes.map(({ counts, headIndex }) => ({ counts, headIndex })), parameters: { verticalAnchor, facing, roll: pivot.rotation.z, modelScale: model.scale.x, modelPositionY: model.position.y } };
          };
          window.__framingSeek = (time, sway, yawOffset, draw = false) => {
            mixer.setTime(time);
            pivot.position.y = verticalAnchor + sway;
            pivot.rotation.y = facing + yawOffset;
            scene.updateMatrixWorld(true);
            camera.updateMatrixWorld(true);
            const result = {};
            for (const name of ["crown", "face", "eye"]) result[name] = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
            const stageRect = mount.getBoundingClientRect();
            const cardTop = (document.querySelector(".game-card").getBoundingClientRect().top - stageRect.top) / stageRect.height;
            const safeVerticalDelta = { minimumForFace: -Infinity, minimumForEye: -Infinity, maximumForCrown: Infinity };
            const point = new THREE.Vector3();
            for (const { object, selectedVertices } of framingMeshes) {
              for (const vertex of selectedVertices) {
                object.getVertexPosition(vertex.index, point);
                point.applyMatrix4(object.matrixWorld);
                const verticalCoefficient = camera.projectionMatrix.elements[5] / (2 * (camera.position.z - point.z));
                point.project(camera);
                const x = (point.x + 1) / 2, y = (1 - point.y) / 2;
                if (vertex.crown) safeVerticalDelta.maximumForCrown = Math.min(safeVerticalDelta.maximumForCrown, y / verticalCoefficient);
                if (vertex.face) safeVerticalDelta.minimumForFace = Math.max(safeVerticalDelta.minimumForFace, (y - cardTop) / verticalCoefficient);
                if (vertex.eye) safeVerticalDelta.minimumForEye = Math.max(safeVerticalDelta.minimumForEye, (y - cardTop) / verticalCoefficient);
                for (const name of ["crown", "face", "eye"]) if (vertex[name]) {
                  const bounds = result[name];
                  bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
                  bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
                }
              }
            }
            if (draw) renderer.render(scene, camera);
            return { time, sway, yawOffset, bounds: result, cameraAspect: camera.aspect, safeVerticalDelta };
          };
`;

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route((url) => url.pathname.endsWith("/src/CreatureStage.tsx"), async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    const marker = "setActiveAnimation(idle.name);";
    assert.ok(source.includes(marker), "development module contains the expected Idle callback");
    await route.fulfill({ response, body: source.replace(marker, `${marker}\n${instrumentation}`) });
  });
  await page.goto(process.env.CROWNFALL_FRAMING_URL || "http://localhost:5173");
  await page.locator(".creature-model--loaded").waitFor({ timeout: 60000 });
  const setup = await page.evaluate(() => window.__framingSetup());
  assert.ok(setup.counts.every(({ counts }) => counts.crown > 10 && counts.face > 10 && counts.eye > 10));
  const sampling = await page.evaluate(() => {
    const setup = window.__framingSetup();
    const times = [...setup.authoredTimes];
    for (let index = 1; index < setup.authoredTimes.length; index++) times.push((setup.authoredTimes[index - 1] + setup.authoredTimes[index]) / 2);
    times.sort((a, b) => a - b);
    const samples = [];
    for (const time of times) for (const sway of [-0.012, 0, 0.012]) for (const yaw of [-0.018, 0, 0.018]) samples.push(window.__framingSeek(time, sway, yaw));
    return { sampleTimes: times, samples, idleZero: window.__framingSeek(0, 0, 0, true) };
  });
  const dimensions = async () => page.evaluate(() => {
    const rect = (element) => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; };
    return { stage: rect(document.querySelector(".creature-stage")), card: rect(document.querySelector(".game-card")) };
  });
  const original = await dimensions();
  await page.evaluate(({ pose, dimensions }) => {
    for (const [name, bounds] of Object.entries(pose.bounds)) {
      const overlay = document.createElement("div");
      overlay.dataset.framingOverlay = name;
      Object.assign(overlay.style, { position: "fixed", zIndex: "1000", pointerEvents: "none", border: `1px solid ${{ crown: "#ffdf00", face: "#ff55ff", eye: "#55ffff" }[name]}`, left: `${dimensions.stage.x + bounds.minX * dimensions.stage.width}px`, top: `${dimensions.stage.y + bounds.minY * dimensions.stage.height}px`, width: `${(bounds.maxX - bounds.minX) * dimensions.stage.width}px`, height: `${(bounds.maxY - bounds.minY) * dimensions.stage.height}px`, color: "white", font: "10px monospace" });
      overlay.textContent = `${name} proxy`;
      document.body.appendChild(overlay);
    }
  }, { pose: sampling.idleZero, dimensions: original });
  await page.screenshot({ path: `${directory}/proxy-calibration-1280.png` });
  await page.evaluate(() => document.querySelectorAll("[data-framing-overlay]").forEach((element) => element.remove()));
  const viewportResults = [];
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const boxes = await dimensions();
    const check = await page.evaluate(() => window.__framingSeek(0, 0, 0));
    let normalizedSamples = sampling.samples;
    if (Math.abs(check.cameraAspect - sampling.idleZero.cameraAspect) >= 0.0001) {
      normalizedSamples = await page.evaluate((times) => {
        const samples = [];
        for (const time of times) for (const sway of [-0.012, 0, 0.012]) for (const yaw of [-0.018, 0, 0.018]) samples.push(window.__framingSeek(time, sway, yaw));
        return samples;
      }, sampling.sampleTimes);
    }
    const projection = (pose) => Object.fromEntries(Object.entries(pose.bounds).map(([name, bounds]) => [name, { ...bounds, minY: boxes.stage.y + bounds.minY * boxes.stage.height, maxY: boxes.stage.y + bounds.maxY * boxes.stage.height, minX: boxes.stage.x + bounds.minX * boxes.stage.width, maxX: boxes.stage.x + bounds.maxX * boxes.stage.width }]));
    const samples = normalizedSamples.map((pose) => ({ ...pose, projected: projection(pose) }));
    const crown = samples.reduce((a, b) => a.projected.crown.minY < b.projected.crown.minY ? a : b);
    const face = samples.reduce((a, b) => a.projected.face.maxY > b.projected.face.maxY ? a : b);
    const eye = samples.reduce((a, b) => a.projected.eye.maxY > b.projected.eye.maxY ? a : b);
    const summarize = (pose) => ({ time: pose.time, sway: pose.sway, yawOffset: pose.yawOffset, bounds: pose.projected });
    const minimumDelta = Math.max(...samples.map((pose) => Math.max(pose.safeVerticalDelta.minimumForFace, pose.safeVerticalDelta.minimumForEye)));
    const maximumDelta = Math.min(...samples.map((pose) => pose.safeVerticalDelta.maximumForCrown));
    viewportResults.push({ viewport, dimensions: boxes, idleZero: projection(check), minimumCrownMarginPx: crown.projected.crown.minY - boxes.stage.y, minimumFaceClearancePx: boxes.card.y - face.projected.face.maxY, minimumEyeClearancePx: boxes.card.y - eye.projected.eye.maxY, sampledSafeVerticalAnchorRange: [setup.parameters.verticalAnchor + minimumDelta, setup.parameters.verticalAnchor + maximumDelta], crownWorstPose: summarize(crown), faceWorstPose: summarize(face), eyeWorstPose: summarize(eye) });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  for (const name of ["crown", "eye"]) {
    const pose = viewportResults[0][`${name}WorstPose`];
    await page.evaluate(({ time, sway, yawOffset }) => window.__framingSeek(time, sway, yawOffset, true), pose);
    await page.screenshot({ path: `${directory}/sampled-worst-${name}-1280.png` });
  }
  const report = {
    technique: "Actual decoded/skinned GLB vertices projected through the running application's camera; instrumentation injected only through Playwright development-module interception. No product edits or shipped debug globals.",
    limitations: "Dense authored-key-time and midpoint samples combined with independent ambient extrema, not a continuous mathematical proof. Crown/face/eye regions are explicitly defined rest-space geometric proxies, not semantic image detections. Crown proxy includes highest crown/hair geometry. Overlay calibration is provided for review.",
    featureDefinitions: { crown: "rest Y >= 0.94", face: "head joint weight > 0.5; rest Y 0.80..0.90; |X| < 0.085; Z > 0.045", eye: "head joint weight > 0.5; rest Y 0.81..0.865; |X| < 0.045; Z > 0.065" },
    setup,
    authoredTimesCount: setup.authoredTimes.length,
    sampledTimesCount: sampling.sampleTimes.length,
    sampledPoses: sampling.samples.length,
    sampleTimes: sampling.sampleTimes,
    ambientValues: { sway: [-0.012, 0, 0.012], yawOffset: [-0.018, 0, 0.018] },
    viewportResults,
    browserErrors: errors,
  };
  await writeFile(`${directory}/idle-framing.json`, `${JSON.stringify(report, null, 2)}\n`);
  assert.deepEqual(errors, []);
  for (const result of viewportResults) {
    assert.ok(result.minimumCrownMarginPx > 0, `sampled crown is inside the stage: ${JSON.stringify(result.viewport)}`);
    assert.ok(result.minimumFaceClearancePx > 0, `sampled conservative face proxy clears the cards: ${JSON.stringify(result.viewport)}`);
    assert.ok(result.minimumEyeClearancePx > 0, `sampled eye proxy clears the cards: ${JSON.stringify(result.viewport)}`);
  }
  console.log(JSON.stringify({ sampledPoses: report.sampledPoses, features: setup.counts, results: viewportResults.map(({ viewport, minimumCrownMarginPx, minimumFaceClearancePx, minimumEyeClearancePx }) => ({ viewport, minimumCrownMarginPx, minimumFaceClearancePx, minimumEyeClearancePx })) }, null, 2));
} finally {
  await browser.close();
}
