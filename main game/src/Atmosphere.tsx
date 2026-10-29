import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  nextRenderTimestamp,
  normalizeFrameLimit,
  normalizeRenderScale,
  scaledPixelRatio,
} from "./effects/render-controls";
import type { FrameLimit } from "./effects/render-controls";
import "./effects/atmosphere.css";

export type EffectsQuality = "low" | "medium" | "high";

const vertexShader = `
  attribute float aSeed;
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uScale;
  uniform float uMotion;
  varying vec3 vColor;
  varying float vOpacity;
  void main() {
    vec3 p = position;
    float t = uTime * uMotion;
    p.x += sin(t * .19 + aSeed * 32.) * .012;
    p.y = mod(p.y + t * (.005 + aSeed * .011) + 1., 1.);
    p.x += sin(p.y * 12. + t * .38 + aSeed * 50.) * .009;
    gl_Position = vec4(p.x * 2. - 1., p.y * 2. - 1., 0., 1.);
    float shimmer = .58 + .42 * sin(t * (1. + aSeed) + aSeed * 60.);
    gl_PointSize = aSize * uScale * (.75 + shimmer * .25);
    vColor = aColor;
    vOpacity = (.24 + shimmer * .61) * (.5 + position.z * .5);
  }
`;

const fragmentShader = `
  precision mediump float;
  varying vec3 vColor;
  varying float vOpacity;
  void main() {
    vec2 uv = gl_PointCoord - .5;
    float d = length(uv * vec2(1., 1.15));
    float halo = exp(-d * d * 21.) * .24;
    float core = exp(-d * d * 100.);
    float fleck = exp(-length(uv * vec2(1., .7)) * 19.) * .45;
    float a = (halo + core + fleck) * vOpacity;
    if (a < .008) discard;
    gl_FragColor = vec4(vColor * 1.25, a);
  }
`;

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function Feather({ className }: { className: string }) {
  return (
    <svg
      className={`spirit-feather ${className}`}
      viewBox="0 0 90 42"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`plume-${className}`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#a4b3a6" stopOpacity=".08" />
          <stop offset=".55" stopColor="#d6d4ba" stopOpacity=".65" />
          <stop offset="1" stopColor="#8eab9a" stopOpacity=".04" />
        </linearGradient>
      </defs>
      <path
        d="M4 32 C21 6 48 2 81 9 C65 26 39 37 4 32Z"
        fill={`url(#plume-${className})`}
        opacity=".2"
      />
      <path
        d="M2 35 Q40 18 82 9"
        fill="none"
        stroke="#c0c5ba"
        strokeWidth=".65"
        opacity=".6"
      />
      {Array.from({ length: 35 }, (_, i) => {
        const x = 10 + i * 2;
        const y = 34 - x * 0.31;
        const spread = Math.sin((i / 38) * Math.PI) * 14;
        return (
          <path
            key={i}
            d={`M${x} ${y} q${-spread * 0.7} ${-spread * 0.6} ${-spread * 0.5} ${-spread} M${x} ${y} q${spread * 0.4} ${spread * 0.5} ${spread * 1.2} ${spread * 0.2}`}
            fill="none"
            stroke="#c3ccbe"
            strokeWidth=".6"
            opacity={0.18 + (i % 3) * 0.09}
          />
        );
      })}
    </svg>
  );
}

export default function Atmosphere({
  quality = "high",
  reducedMotion: requestedReducedMotion = false,
  renderScale = 100,
  frameLimit = 0,
  suspended = false,
}: {
  quality?: EffectsQuality;
  reducedMotion?: boolean;
  renderScale?: number;
  frameLimit?: FrameLimit;
  /** Hidden and paused behind a full-stage destination (My Legacy), keeping the renderer. */
  suspended?: boolean;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [systemReducedMotion, setSystemReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const reducedMotion = requestedReducedMotion || systemReducedMotion;
  const renderScaleRef = useRef(normalizeRenderScale(renderScale));
  const frameLimitRef = useRef(normalizeFrameLimit(frameLimit));
  const resizeControlRef = useRef<(() => void) | null>(null);
  const suspendedRef = useRef(suspended);
  const suspendControlRef = useRef<((value: boolean) => void) | null>(null);

  useEffect(() => {
    if (suspendedRef.current === suspended) return;
    suspendedRef.current = suspended;
    suspendControlRef.current?.(suspended);
  }, [suspended]);

  useEffect(() => {
    const scale = normalizeRenderScale(renderScale);
    const changed = renderScaleRef.current !== scale;
    renderScaleRef.current = scale;
    frameLimitRef.current = normalizeFrameLimit(frameLimit);
    if (changed) resizeControlRef.current?.();
  }, [renderScale, frameLimit]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setSystemReducedMotion(preference.matches);
    preference.addEventListener("change", onChange);
    return () => preference.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || quality === "low") return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: false,
        powerPreference: "low-power",
      });
    } catch {
      return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(scaledPixelRatio(window.devicePixelRatio, renderScaleRef.current));
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.Camera();
    const random = seededRandom(46207);
    const count = quality === "high" ? 195 : 98;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const isSpirit = i < count * 0.82;
      let x = random();
      let y = random();
      if (i < count * 0.39) {
        x = 0.66 + x * 0.33;
        y = 0.63 + y * 0.35;
      } else if (i < count * 0.52) {
        x = 0.5 + x * 0.09;
        y = 0.54 + y * 0.27;
      } else if (isSpirit) {
        x = 0.88 + x * 0.12;
      }
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = random();
      seeds[i] = random();
      sizes[i] = isSpirit ? 9 + random() * 27 : 2.2 + random() * 7;
      const color = new THREE.Color(isSpirit ? "#71e7cf" : "#bb8d51");
      if (isSpirit && i % 5 === 0) color.set("#b4e9ce");
      colors.set(color.toArray(), i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 1 },
        uMotion: { value: reducedMotion ? 0 : 1 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    scene.add(new THREE.Points(geometry, material));
    const resize = () => {
      const { width, height } = mount.getBoundingClientRect();
      if (!width || !height) return;
      const pixelRatio = scaledPixelRatio(window.devicePixelRatio, renderScaleRef.current);
      if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height);
      material.uniforms.uScale.value =
        Math.max(0.55, height / 714) * renderer.getPixelRatio();
      if (!suspendedRef.current) renderer.render(scene, camera);
    };
    resizeControlRef.current = resize;
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();
    let frame = 0;
    const start = performance.now();
    let lastRendered = start;
    // Time spent suspended is excluded, so the motes resume exactly where they paused.
    let suspendedAt = suspendedRef.current ? start : 0;
    let suspendedTotal = 0;
    const render = (now: number) => {
      frame = requestAnimationFrame(render);
      if (document.hidden) return;
      const timestamp = nextRenderTimestamp(now, lastRendered, frameLimitRef.current);
      if (timestamp === null) return;
      lastRendered = timestamp;
      material.uniforms.uTime.value = (now - start - suspendedTotal) / 1000;
      renderer.render(scene, camera);
    };
    const setSuspended = (value: boolean) => {
      cancelAnimationFrame(frame);
      frame = 0;
      const now = performance.now();
      if (value) {
        suspendedAt = now;
        return;
      }
      if (suspendedAt) suspendedTotal += now - suspendedAt;
      suspendedAt = 0;
      resize();
      if (!reducedMotion) frame = requestAnimationFrame(render);
    };
    suspendControlRef.current = setSuspended;
    if (!reducedMotion && !suspendedRef.current) frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      if (suspendControlRef.current === setSuspended) suspendControlRef.current = null;
      if (resizeControlRef.current === resize) resizeControlRef.current = null;
      observer.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [quality, reducedMotion]);

  return (
    <div
      className={`atmosphere atmosphere--${quality}${reducedMotion ? " atmosphere--still" : ""}${suspended ? " is-suspended" : ""}`}
      aria-hidden="true"
    >
      <div className="spirit-aura" />
      {quality !== "low" && (
        <svg
          className="soul-streams"
          viewBox="0 0 1280 714"
          preserveAspectRatio="none"
        >
          <defs>
            <filter id="stream-glow">
              <feGaussianBlur stdDeviation="2.4" />
            </filter>
          </defs>
          <g
            fill="none"
            stroke="#82f7d9"
            strokeWidth="3"
            opacity=".34"
            filter="url(#stream-glow)"
          >
            <path d="M665 259 C719 214 646 207 686 157 C708 132 681 120 691 97" />
            <path d="M1168 177 C1256 161 1255 130 1218 99 C1191 69 1212 52 1235 37" />
            <path d="M1221 351 C1175 320 1227 302 1206 269 C1192 250 1201 222 1232 207" />
            <path d="M1002 94 C1023 52 1105 64 1075 9" />
          </g>
        </svg>
      )}
      <div ref={mountRef} className="mote-field" />
      {quality === "high" && (
        <>
          <Feather className="plume-one" />
          <Feather className="plume-two" />
          <Feather className="plume-three" />
        </>
      )}
    </div>
  );
}
