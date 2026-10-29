// Development harness (?legacyEnvironment): the environment full screen with
// labelled development fixtures. Query parameters: nation, fixture, view
// (establishing | founding | representative | banner-hall | muster-grounds |
// war-record | heralds-station | district:<court|lower-town|west-gate|forge|road|eclipse>),
// quality (low | medium | high), post (0 | 1), labels (0 | 1).

import type { CameraFraming } from "../../../../shared/legacy/environment/blueprint/types";
import { DEVELOPMENT_FIXTURE_CAPTION, ENVIRONMENT_FIXTURE_IDS, environmentFixture } from "../../../../shared/legacy/environment/fixtures";
import type { EnvironmentFixtureId } from "../../../../shared/legacy/environment/fixtures";
import { LEGACY_LANDMARKS } from "../../../../shared/legacy/environment-contract";
import type { LandmarkId, NationId } from "../../../../shared/legacy/types";
import type { DesktopEnvironmentQuality } from "../environment-contract";
import { BannerholdEnvironment } from "./environment";

const NATIONS: readonly NationId[] = ["korvenia", "solforiz", "aethelgard", "kwind-09"];
const VIEWS = ["establishing", "founding", "representative", "banner-hall", "muster-grounds", "war-record", "heralds-station", "district:court", "district:lower-town", "district:west-gate", "district:forge", "district:road", "district:eclipse"] as const;

interface HarnessApi {
  env: BannerholdEnvironment | null;
  ready: Promise<void>;
  setView(view: string, instant?: boolean): boolean;
  setFixture(id: EnvironmentFixtureId): void;
  setQuality(preset: DesktopEnvironmentQuality["preset"]): void;
  waitIdle(): Promise<void>;
}

declare global {
  interface Window {
    __bannerhold?: HarnessApi;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style: Partial<CSSStyleDeclaration>, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e.style, style);
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Development views derived from the blueprint's destinations (not shipped framings). */
function districtFramings(env: BannerholdEnvironment): CameraFraming[] {
  const build = env.currentBuild;
  if (!build) return [];
  const dest = (id: string): readonly [number, number] | null => {
    const d = build.staging.destinations.find((x) => x.id === id);
    return d ? d.position : null;
  };
  const ground = (x: number, z: number): number => {
    const f = build.field;
    const c = Math.min(f.columns - 1, Math.max(0, Math.round((x - f.originX) / f.cellSize)));
    const r = Math.min(f.rows - 1, Math.max(0, Math.round((z - f.originZ) / f.cellSize)));
    return f.heights[r * f.columns + c];
  };
  // Segment test against the camera-blocking collider boxes (yaw is three.js rotation.y).
  const blockers = build.colliders.filter((c) => c.blocksCamera);
  const blocked = (a: readonly number[], p: readonly number[]): boolean => {
    for (const c of blockers) {
      const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
      const local = (q: readonly number[]): number[] => {
        const wx = q[0] - c.center[0], wy = q[1] - c.center[1], wz = q[2] - c.center[2];
        return [cs * wx - sn * wz, wy, sn * wx + cs * wz];
      };
      const p0 = local(a), p1 = local(p);
      let t0 = 0, t1 = 1, miss = false;
      for (let k = 0; k < 3 && !miss; k++) {
        const d = p1[k] - p0[k], h = c.halfExtents[k];
        if (Math.abs(d) < 1e-9) {
          if (p0[k] < -h || p0[k] > h) miss = true;
          continue;
        }
        let ta = (-h - p0[k]) / d, tb = (h - p0[k]) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) miss = true;
      }
      if (!miss) return true;
    }
    return false;
  };
  const make = (id: string, label: string, at: readonly [number, number] | null, bearing: number, dist: number, rise: number, lift: number, fov: number, search = false): CameraFraming | null => {
    if (!at) return null;
    const ty = ground(at[0], at[1]) + lift;
    const place = (deg: number, up: number): number[] => {
      const r = (deg * Math.PI) / 180;
      return [at[0] + Math.sin(r) * dist, ty + up, at[1] - Math.cos(r) * dist];
    };
    let position = place(bearing, rise);
    // Searching views turn (then rise) until the line from just beside the subject to the
    // camera clears every building, so the rig's collision never pulls them into a wall.
    if (search) {
      found: for (let r = 0; r < 3; r++) {
        for (let k = 0; k <= 24; k++) {
          const deg = bearing + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 15;
          const cand = place(deg, rise + r * 8);
          const start = [at[0] + (cand[0] - at[0]) * 0.08, ty + (cand[1] - ty) * 0.08, at[1] + (cand[2] - at[1]) * 0.08];
          if (!blocked(start, cand)) {
            position = cand;
            break found;
          }
        }
      }
    }
    return {
      id: id as CameraFraming["id"],
      label,
      position: [position[0], position[1], position[2]],
      target: [at[0], ty, at[1]],
      fovDeg: fov,
      orbit: { yawDeg: [-40, 40], pitchDeg: [-10, 50], distance: [dist * 0.5, dist * 1.6] },
      transitionSeconds: 1.6,
      composition: "Development close-up",
    };
  };
  const out = [
    make("district:court", "Banner Court (development view)", dest("ceremonial"), 52, 46, 16, 6, 46),
    make("district:lower-town", "Lower town (development view)", dest("residential"), 20, 30, 15, 1.5, 50, true),
    make("district:west-gate", "West Gate (development view)", dest("gate"), 262, 44, 7, 4, 44),
    make("district:forge", "Forge yards (development view)", dest("artisan"), 165, 28, 11, 2, 48),
    make("district:road", "Road to the capital (development view)", dest("gate"), 232, 120, 6, 8, 40),
    // Looking up toward the eclipse corona over the West Gate (the sky and key light check).
    make("district:eclipse", "Toward the eclipse (development view)", dest("gate"), 65, 40, -6, 16, 55),
  ];
  return out.filter((f): f is CameraFraming => f !== null);
}

export function mountLegacyEnvironmentHarness(root: HTMLElement): void {
  const q = new URLSearchParams(window.location.search);
  const nation = (NATIONS as readonly string[]).indexOf(q.get("nation") ?? "") >= 0 ? (q.get("nation") as NationId) : "korvenia";
  let fixture = ((ENVIRONMENT_FIXTURE_IDS as readonly string[]).indexOf(q.get("fixture") ?? "") >= 0 ? q.get("fixture") : "founded") as EnvironmentFixtureId;
  const preset = (["low", "medium", "high"].indexOf(q.get("quality") ?? "") >= 0 ? q.get("quality") : "medium") as DesktopEnvironmentQuality["preset"];
  // Optional post follows the preset (never on low) unless ?post=0 turns it off.
  const postOverride = q.has("post") ? q.get("post") !== "0" : undefined;
  let post = (postOverride ?? true) && preset !== "low";
  let shownPreset = preset;
  const labels = q.get("labels") !== "0";
  const initialView = q.get("view") ?? "establishing";
  document.title = "Bannerhold environment harness (development)";
  root.innerHTML = "";
  Object.assign(document.body.style, { margin: "0", background: "#120f16", overflow: "hidden" });
  const stage = el("div", { position: "fixed", inset: "0", background: "#120f16" });
  root.appendChild(stage);
  const caption = el("div", { position: "fixed", left: "16px", top: "14px", padding: "6px 10px", background: "rgba(14,10,18,0.78)", color: "#e9dcc0", font: "600 12px/1.35 system-ui, sans-serif", letterSpacing: "0.04em", border: "1px solid rgba(201,162,58,0.55)", borderRadius: "3px", zIndex: "10", pointerEvents: "none" });
  const setCaption = (): void => {
    caption.textContent = `${DEVELOPMENT_FIXTURE_CAPTION} — fixture: ${fixture} · ${nation} · ${shownPreset}${post ? " · post" : ""}`;
  };
  setCaption();
  root.appendChild(caption);
  const status = el("div", { position: "fixed", right: "16px", top: "14px", padding: "4px 8px", background: "rgba(14,10,18,0.6)", color: "#bfb4a0", font: "11px/1.3 ui-monospace, monospace", zIndex: "10", pointerEvents: "none", whiteSpace: "pre" }, "Building the Bannerhold…");
  root.appendChild(status);
  const panel = el("div", { position: "fixed", left: "16px", bottom: "16px", display: "flex", flexWrap: "wrap", gap: "6px", maxWidth: "calc(100vw - 32px)", zIndex: "10" });
  root.appendChild(panel);
  const labelLayer = el("div", { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "5" });
  root.appendChild(labelLayer);
  const labelEls = new Map<LandmarkId, HTMLDivElement>();
  let env: BannerholdEnvironment | null = null;
  const quality: DesktopEnvironmentQuality = { preset, renderScale: 100, frameLimit: 60 };
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((r) => (resolveReady = r));
  const setView = (view: string, instant = false): boolean => {
    if (!env) return false;
    if ((LEGACY_LANDMARKS as readonly string[]).indexOf(view) >= 0) return env.focusFraming(`landmark:${view}`, instant);
    return env.focusFraming(view, instant);
  };
  const button = (text: string, onClick: () => void): HTMLButtonElement => {
    const b = el("button", { font: "600 12px system-ui, sans-serif", color: "#efe4cc", background: "rgba(26,20,32,0.85)", border: "1px solid rgba(201,162,58,0.45)", borderRadius: "3px", padding: "6px 9px", cursor: "pointer" }, text);
    b.addEventListener("click", onClick);
    panel.appendChild(b);
    return b;
  };
  for (const v of VIEWS) button(v.replace("district:", "◦ "), () => setView(v));
  const fixtureSelect = el("select", { font: "12px system-ui", background: "rgba(26,20,32,0.85)", color: "#efe4cc", border: "1px solid rgba(201,162,58,0.45)" });
  for (const f of ENVIRONMENT_FIXTURE_IDS) {
    const o = document.createElement("option");
    o.value = f;
    o.textContent = `fixture: ${f}`;
    if (f === fixture) o.selected = true;
    fixtureSelect.appendChild(o);
  }
  fixtureSelect.addEventListener("change", () => api.setFixture(fixtureSelect.value as EnvironmentFixtureId));
  panel.appendChild(fixtureSelect);
  const api: HarnessApi = {
    env: null,
    ready,
    setView,
    setFixture(id) {
      fixture = id;
      setCaption();
      env?.setState(environmentFixture(id, nation));
    },
    setQuality(p) {
      quality.preset = p;
      post = (postOverride ?? true) && p !== "low";
      shownPreset = p;
      setCaption();
      env?.setQuality({ ...quality });
    },
    async waitIdle() {
      for (let i = 0; i < 600; i++) {
        if (env && !env.busy) return;
        await new Promise((r) => setTimeout(r, 50));
      }
    },
  };
  window.__bannerhold = api;
  const created = new BannerholdEnvironment(
    {
      container: stage,
      state: environmentFixture(fixture, nation),
      quality,
      reducedMotion: q.get("reducedMotion") === "1",
      onLandmarkHover: (id) => {
        labelEls.forEach((e, k) => (e.style.borderColor = k === id ? "rgba(255,200,110,0.95)" : "rgba(201,162,58,0.45)"));
      },
      onLandmarkSelect: (id) => created.focusLandmark(id),
      onReady: () => {
        for (const f of districtFramings(created)) created.defineFraming(f);
        if (!setView(initialView, true)) setView("establishing", true);
        resolveReady();
      },
    },
    { post: postOverride },
  );
  env = created;
  api.env = created;
  void created.init().catch((e: unknown) => {
    status.textContent = `Environment failed: ${e instanceof Error ? e.message : String(e)}`;
  });
  if (labels) {
    for (const id of LEGACY_LANDMARKS) {
      const l = el("div", { position: "absolute", transform: "translate(-50%, -100%)", padding: "3px 8px", font: "600 11px system-ui, sans-serif", letterSpacing: "0.06em", textTransform: "uppercase", color: "#f1e6cf", background: "rgba(16,12,20,0.72)", border: "1px solid rgba(201,162,58,0.45)", borderRadius: "2px", whiteSpace: "nowrap", display: "none" });
      labelLayer.appendChild(l);
      labelEls.set(id, l);
    }
  }
  const tick = (): void => {
    requestAnimationFrame(tick);
    if (!env) return;
    const landmarks = env.getLandmarks();
    for (const lm of landmarks) {
      const e = labelEls.get(lm.id);
      if (!e) continue;
      const a = env.projectLandmark(lm.id);
      if (!a || !a.visible) {
        e.style.display = "none";
        continue;
      }
      if (e.textContent !== lm.label) e.textContent = lm.label;
      e.style.display = "block";
      e.style.left = `${a.x}px`;
      e.style.top = `${a.y}px`;
    }
    const s = env.getStats();
    const d = env.debugInfo();
    const ft = s.frameTimesMs;
    const avg = ft.length ? ft.reduce((x, y) => x + y, 0) / ft.length : 0;
    status.textContent = `draws ${s.drawCalls} · tris ${(s.triangles / 1000).toFixed(0)}k · geo ${s.geometries} · tex ${s.textures}\nbuild ${d.buildMs.toFixed(0)} ms · frame ${avg.toFixed(1)} ms (software GL, not representative)`;
  };
  requestAnimationFrame(tick);
}
