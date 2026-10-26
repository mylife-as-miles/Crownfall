import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { CREATURE_MODEL_URL } from "./effects/creature-config";
import {
  nextRenderTimestamp,
  normalizeFrameLimit,
  normalizeRenderScale,
  scaledPixelRatio,
} from "./effects/render-controls";
import type { FrameLimit } from "./effects/render-controls";
import type { CreatureLoadState } from "./loading-types";
import "./effects/atmosphere.css";

interface CreatureStageProps {
  reducedMotion?: boolean;
  modelUrl?: string;
  fallbackSrc?: string;
  renderScale?: number;
  frameLimit?: FrameLimit;
  onLoadState?: (state: CreatureLoadState) => void;
  loadAttempt?: number;
}

function disposeModel(root: THREE.Object3D | null | undefined) {
  if (!root) return;
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
      material.dispose();
    }
  });
  for (const texture of textures) texture.dispose();
}

export default function CreatureStage({
  reducedMotion = false,
  modelUrl,
  fallbackSrc = `${import.meta.env.BASE_URL}assets/creature.webp`,
  renderScale = 100,
  frameLimit = 0,
  onLoadState,
  loadAttempt = 0,
}: CreatureStageProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [activeAnimation, setActiveAnimation] = useState<string | null>(null);
  const [systemReducedMotion, setSystemReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const motionDisabled = reducedMotion || systemReducedMotion;
  const motionDisabledRef = useRef(motionDisabled);
  const motionControlRef = useRef<((paused: boolean) => void) | null>(null);
  const renderScaleRef = useRef(normalizeRenderScale(renderScale));
  const frameLimitRef = useRef(normalizeFrameLimit(frameLimit));
  const resizeControlRef = useRef<(() => void) | null>(null);
  const loadStateCallbackRef = useRef(onLoadState);
  const requestedSource =
    modelUrl ?? new URLSearchParams(window.location.search).get("model");
  const source =
    requestedSource === "none" ? null : (requestedSource ?? CREATURE_MODEL_URL);

  useEffect(() => {
    loadStateCallbackRef.current = onLoadState;
  }, [onLoadState]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setSystemReducedMotion(preference.matches);
    preference.addEventListener("change", onChange);
    return () => preference.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    motionDisabledRef.current = motionDisabled;
    motionControlRef.current?.(motionDisabled);
  }, [motionDisabled]);

  useEffect(() => {
    const scale = normalizeRenderScale(renderScale);
    const changed = renderScaleRef.current !== scale;
    renderScaleRef.current = scale;
    frameLimitRef.current = normalizeFrameLimit(frameLimit);
    if (changed) resizeControlRef.current?.();
  }, [renderScale, frameLimit]);

  useEffect(() => {
    setLoaded(false);
    setActiveAnimation(null);
    const mount = mountRef.current;
    let active = true;
    const disposers: (() => void)[] = [];
    const cleanup = () => {
      active = false;
      for (const dispose of disposers.splice(0).reverse()) dispose();
    };
    const emit = (state: CreatureLoadState) => {
      if (active) loadStateCallbackRef.current?.(state);
    };
    const fallback = (reason: string) => {
      if (!active) return;
      setLoaded(false);
      setActiveAnimation(null);
      emit({ status: "fallback", phase: "illustration", error: reason });
      cleanup();
    };
    if (!source) {
      emit({ status: "fallback", phase: "illustration" });
      return cleanup;
    }
    if (!mount) {
      fallback(
        "The character display is unavailable. Using the illustrated character.",
      );
      return cleanup;
    }
    emit({ status: "loading", phase: "download" });
    try {
      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
        });
      } catch {
        fallback(
          "3D graphics are unavailable. Using the illustrated character.",
        );
        return cleanup;
      }
      disposers.push(() => {
        renderer.dispose();
        renderer.domElement.remove();
      });
      renderer.setPixelRatio(
        scaledPixelRatio(window.devicePixelRatio, renderScaleRef.current),
      );
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.72;
      renderer.domElement.setAttribute("aria-hidden", "true");
      mount.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(36, 1280 / 714, 0.05, 100);
      camera.position.set(0, 0, 6.5);
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      let environment: THREE.WebGLRenderTarget;
      try {
        environment = pmrem.fromScene(room, 0.04);
      } finally {
        room.dispose();
        pmrem.dispose();
      }
      disposers.push(() => environment.dispose());
      scene.environment = environment.texture;
      scene.environmentIntensity = 0.38;
      const hemisphere = new THREE.HemisphereLight("#c8d5be", "#241a0a", 0.45);
      const gold = new THREE.DirectionalLight("#fff0d5", 1.7);
      gold.position.set(-3, 6, 5);
      const teal = new THREE.DirectionalLight("#63edce", 1.5);
      teal.position.set(4, 3, -2);
      const fill = new THREE.PointLight("#3ac4b0", 0.8, 12, 2);
      fill.position.set(1, 1, 4);
      scene.add(hemisphere, gold, teal, fill);
      const draco = new DRACOLoader().setDecoderPath(
        `${import.meta.env.BASE_URL}decoders/draco/`,
      );
      disposers.push(() => draco.dispose());
      const ktx2 = new KTX2Loader()
        .setTranscoderPath(
          "https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/basis/",
        )
        .detectSupport(renderer);
      disposers.push(() => ktx2.dispose());
      const loader = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2);
      let downloadBytes: Pick<CreatureLoadState, "loadedBytes" | "totalBytes"> =
        {};
      const parse = loader.parse.bind(loader);
      loader.parse = (data, path, onParsed, onError) => {
        if (!active) {
          onError?.(
            new ErrorEvent("error", {
              message: "Character loading was cancelled.",
            }),
          );
          return;
        }
        emit({ status: "loading", phase: "decode", ...downloadBytes });
        parse(data, path, onParsed, onError);
      };
      const pivot = new THREE.Group();
      const verticalAnchor = 0.055;
      pivot.position.y = verticalAnchor;
      // Turn toward the cards and lean the whole animated rig, including all arms.
      const facing = -0.47;
      pivot.rotation.order = "ZYX";
      pivot.rotation.y = facing;
      pivot.rotation.z = 0.045;
      scene.add(pivot);
      let model: THREE.Group | null = null;
      let mixer: THREE.AnimationMixer | null = null;
      let frame = 0;
      let previous = performance.now();
      let lastRendered = previous;
      let activeSeconds = 0;
      const resize = () => {
        if (!active) return;
        const { width, height } = mount.getBoundingClientRect();
        if (!width || !height) return;
        const pixelRatio = scaledPixelRatio(
          window.devicePixelRatio,
          renderScaleRef.current,
        );
        if (renderer.getPixelRatio() !== pixelRatio)
          renderer.setPixelRatio(pixelRatio);
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        pivot.position.x =
          Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) *
          camera.position.z *
          camera.aspect *
          0.47;
        renderer.render(scene, camera);
      };
      resizeControlRef.current = resize;
      disposers.push(() => {
        if (resizeControlRef.current === resize)
          resizeControlRef.current = null;
      });
      const observer = new ResizeObserver(resize);
      disposers.push(() => observer.disconnect());
      observer.observe(mount);
      resize();
      const render = (now: number) => {
        frame = 0;
        if (!active || !model || motionDisabledRef.current || document.hidden)
          return;
        frame = requestAnimationFrame(render);
        const timestamp = nextRenderTimestamp(
          now,
          lastRendered,
          frameLimitRef.current,
        );
        if (timestamp === null) return;
        lastRendered = timestamp;
        // Follow foreground elapsed time, including skipped render frames. A
        // capped delta made the rig nearly still on slower devices.
        const delta = Math.max(0, (now - previous) / 1000);
        previous = now;
        activeSeconds += delta;
        mixer?.update(delta);
        pivot.rotation.y = facing + Math.sin(activeSeconds * 0.22) * 0.018;
        pivot.position.y =
          verticalAnchor + Math.sin(activeSeconds * 0.6) * 0.012;
        renderer.render(scene, camera);
      };
      const setMotionPaused = (paused: boolean) => {
        cancelAnimationFrame(frame);
        frame = 0;
        previous = performance.now();
        lastRendered = previous;
        if (!paused && model && !document.hidden)
          frame = requestAnimationFrame(render);
      };
      const onVisibilityChange = () =>
        setMotionPaused(motionDisabledRef.current);
      document.addEventListener("visibilitychange", onVisibilityChange);
      disposers.push(() =>
        document.removeEventListener("visibilitychange", onVisibilityChange),
      );
      motionControlRef.current = setMotionPaused;
      disposers.push(() => {
        if (motionControlRef.current === setMotionPaused)
          motionControlRef.current = null;
        if (resizeControlRef.current === resize)
          resizeControlRef.current = null;
        cancelAnimationFrame(frame);
        mixer?.stopAllAction();
        if (model) {
          mixer?.uncacheRoot(model);
          disposeModel(model);
        }
      });
      emit({ status: "loading", phase: "download" });
      loader.load(
        source,
        (gltf) => {
          if (!active) {
            disposeModel(gltf.scene);
            return;
          }
          try {
            model = gltf.scene;
            const bounds = new THREE.Box3().setFromObject(model);
            const size = bounds.getSize(new THREE.Vector3());
            const center = bounds.getCenter(new THREE.Vector3());
            if (
              ![size.x, size.y, size.z, center.x, center.y, center.z].every(
                Number.isFinite,
              ) ||
              size.y <= 0
            ) {
              disposeModel(model);
              model = null;
              fallback(
                "The character file has no usable geometry. Using the illustrated character.",
              );
              return;
            }
            const scale = 5.6784 / size.y;
            model.scale.multiplyScalar(scale);
            model.position.sub(center.multiplyScalar(scale));
            // Compensate for the larger rig so the crown keeps its breathing room.
            model.position.y -= 0.96;
            pivot.add(model);
            if (gltf.animations.length) {
              mixer = new THREE.AnimationMixer(model);
              const idle =
                gltf.animations.find((clip) => /idle/i.test(clip.name)) ??
                gltf.animations[0];
              mixer
                .clipAction(idle)
                .setLoop(THREE.LoopRepeat, Infinity)
                .setEffectiveTimeScale(1)
                .setEffectiveWeight(1)
                .play();
              mixer.update(0);
              setActiveAnimation(idle.name);
            }
            emit({ status: "loading", phase: "render", ...downloadBytes });
            if (!active) return;
            renderer.render(scene, camera);
            if (renderer.getContext().isContextLost()) {
              fallback(
                "The graphics connection was interrupted. Using the illustrated character.",
              );
              return;
            }
            if (renderer.info.render.calls === 0) {
              fallback(
                "The character file has no visible renderable geometry. Using the illustrated character.",
              );
              return;
            }
            setLoaded(true);
            emit({ status: "ready", phase: "render", ...downloadBytes });
            setMotionPaused(motionDisabledRef.current);
          } catch {
            fallback(
              "The character could not be prepared or rendered. Using the illustrated character.",
            );
          }
        },
        (event) => {
          if (
            !active ||
            !event.lengthComputable ||
            !Number.isFinite(event.total) ||
            event.total <= 0 ||
            !Number.isFinite(event.loaded)
          )
            return;
          downloadBytes = {
            loadedBytes: event.loaded,
            totalBytes: event.total,
          };
          emit({
            status: "loading",
            phase: event.loaded >= event.total ? "decode" : "download",
            ...downloadBytes,
          });
        },
        () => {
          fallback(
            "The character file could not be downloaded or decoded. Using the illustrated character.",
          );
        },
      );
      return cleanup;
    } catch {
      fallback(
        "3D graphics could not be initialized. Using the illustrated character.",
      );
      return cleanup;
    }
  }, [source, loadAttempt]);

  return (
    <div
      className="creature-stage"
      aria-hidden="true"
      data-active-animation={activeAnimation}
    >
      <img
        className={`creature-illustration${loaded ? " creature-illustration--hidden" : ""}`}
        src={fallbackSrc}
        alt=""
        draggable={false}
      />
      <div
        ref={mountRef}
        className={`creature-model${loaded ? " creature-model--loaded" : ""}`}
      />
    </div>
  );
}
