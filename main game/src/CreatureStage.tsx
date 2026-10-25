import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { CREATURE_MODEL_URL } from "./effects/creature-config";
import "./effects/atmosphere.css";

interface CreatureStageProps {
  reducedMotion?: boolean;
  modelUrl?: string;
  fallbackSrc?: string;
}

function disposeModel(root: THREE.Object3D) {
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
  const requestedSource =
    modelUrl ?? new URLSearchParams(window.location.search).get("model");
  const source =
    requestedSource === "none" ? null : (requestedSource ?? CREATURE_MODEL_URL);

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
    setLoaded(false);
    setActiveAnimation(null);
    const mount = mountRef.current;
    if (!mount || !source) return;
    let active = true;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
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
    const environment = pmrem.fromScene(room, 0.04);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.38;
    room.dispose();
    pmrem.dispose();
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
    const ktx2 = new KTX2Loader()
      .setTranscoderPath(
        "https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/basis/",
      )
      .detectSupport(renderer);
    const loader = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2);
    const pivot = new THREE.Group();
    const facing = -0.34;
    pivot.rotation.y = facing;
    scene.add(pivot);
    let model: THREE.Group | null = null;
    let mixer: THREE.AnimationMixer | null = null;
    let frame = 0;
    let previous = performance.now();
    const start = previous;
    const resize = () => {
      const { width, height } = mount.getBoundingClientRect();
      if (!width || !height) return;
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
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();
    const render = (now: number) => {
      frame = 0;
      if (!active || !model || motionDisabledRef.current) return;
      frame = requestAnimationFrame(render);
      const delta = Math.min((now - previous) / 1000, 0.05);
      previous = now;
      if (document.hidden) return;
      if (!motionDisabledRef.current) {
        mixer?.update(delta * 0.7);
        const time = (now - start) / 1000;
        pivot.rotation.y = facing + Math.sin(time * 0.22) * 0.018;
        pivot.position.y = Math.sin(time * 0.6) * 0.012;
      }
      renderer.render(scene, camera);
    };
    const setMotionPaused = (paused: boolean) => {
      cancelAnimationFrame(frame);
      frame = 0;
      previous = performance.now();
      if (!paused && model) frame = requestAnimationFrame(render);
    };
    motionControlRef.current = setMotionPaused;
    loader.load(
      source,
      (gltf) => {
        if (!active) {
          disposeModel(gltf.scene);
          return;
        }
        model = gltf.scene;
        const bounds = new THREE.Box3().setFromObject(model);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        if (!Number.isFinite(size.y) || size.y <= 0) {
          disposeModel(model);
          model = null;
          return;
        }
        const scale = 5.2 / size.y;
        model.scale.multiplyScalar(scale);
        model.position.sub(center.multiplyScalar(scale));
        model.position.y -= 0.625;
        pivot.add(model);
        if (gltf.animations.length) {
          mixer = new THREE.AnimationMixer(model);
          const idle =
            gltf.animations.find((clip) => /idle/i.test(clip.name)) ??
            gltf.animations[0];
          mixer.clipAction(idle).play();
          mixer.update(0);
          setActiveAnimation(idle.name);
        }
        renderer.render(scene, camera);
        setLoaded(true);
        setMotionPaused(motionDisabledRef.current);
      },
      undefined,
      () => {
        // An unavailable or unsupported model leaves the illustrated character visible.
        if (active) setLoaded(false);
      },
    );
    return () => {
      active = false;
      if (motionControlRef.current === setMotionPaused)
        motionControlRef.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      mixer?.stopAllAction();
      if (model) {
        mixer?.uncacheRoot(model);
        disposeModel(model);
      }
      draco.dispose();
      ktx2.dispose();
      environment.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [source]);

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
