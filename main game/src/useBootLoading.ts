import { useCallback, useEffect, useState } from "react";
import type { CreatureLoadState } from "./loading-types";

const artwork = [
  ["/assets/environments/card-new.webp", "Classic artwork"],
  ["/assets/environments/card-resume.webp", "Portal artwork"],
  ["/assets/environments/card-load.webp", "Chapters artwork"],
  ["/assets/environments/card-browse.webp", "Arena artwork"],
  ["/assets/home/my-legacy.webp", "My Legacy artwork"],
  ["/assets/chronicles/chronicles-map.webp", "Chronicles artwork"],
  ["/assets/home/herald-board.webp", "Herald Board artwork"],
  ["/assets/creature.webp", "Illustrated sorcerer"],
] as const;
const fonts = ["300 16px Barlow", "400 16px Barlow", "500 16px Barlow", "600 16px Barlow", '300 16px "Barlow Condensed"', '400 16px "Barlow Condensed"', '500 16px "Barlow Condensed"'];
const firstModel: CreatureLoadState = { status: "loading", phase: "download" };

export default function useBootLoading(reducedMotion: boolean) {
  const [model, setModel] = useState<CreatureLoadState>(firstModel);
  const [attempt, setAttempt] = useState(0);
  const [assets, setAssets] = useState({ completed: 0, failures: [] as string[] });
  const [phase, setPhase] = useState<"loading" | "leaving" | "complete">("loading");
  const [slow, setSlow] = useState(false);
  const [typeReady, setTypeReady] = useState(false);
  const totalAssets = artwork.length + 1;
  const onModelState = useCallback((state: CreatureLoadState) => setModel(state), []);

  useEffect(() => {
    let active = true;
    const cleanup: (() => void)[] = [];
    const settle = (name: string, success: boolean) => {
      if (active) setAssets(previous => ({ completed: previous.completed + 1, failures: success ? previous.failures : [...previous.failures, name] }));
    };
    artwork.forEach(([url, name]) => {
      const image = new Image();
      let finished = false;
      const finish = (success: boolean) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        image.onload = null;
        image.onerror = null;
        settle(name, success);
      };
      const timer = setTimeout(() => finish(false), 20000);
      image.onload = () => { void image.decode().then(() => finish(true), () => finish(false)); };
      image.onerror = () => finish(false);
      image.src = `${import.meta.env.BASE_URL}${url.slice(1)}`;
      cleanup.push(() => { finished = true; clearTimeout(timer); image.onload = null; image.onerror = null; });
    });
    let fontSettled = false;
    const finishFonts = (success: boolean) => { if (!fontSettled) { fontSettled = true; clearTimeout(fontTimeout); settle("Menu fonts", success); } };
    const fontTimeout = setTimeout(() => finishFonts(false), 20000);
    const fontJobs = fonts.map(font => document.fonts.load(font));
    void Promise.all([fontJobs[1], fontJobs[5]]).then(
      () => { if (active) setTypeReady(true); },
      () => { if (active) setTypeReady(true); },
    );
    void Promise.all(fontJobs).then(() => finishFonts(true), () => finishFonts(false));
    cleanup.push(() => { fontSettled = true; clearTimeout(fontTimeout); });
    return () => { active = false; cleanup.forEach(cancel => cancel()); };
  }, []);

  const settledModel = model.status !== "loading";
  const failures = assets.failures.filter(name => name !== "Illustrated sorcerer" || model.status !== "ready");
  const degraded = !!model.error || failures.length > 0;
  const ready = assets.completed === totalAssets && settledModel;
  const unknownDownload = model.status === "loading" && model.phase === "download" && !model.totalBytes;
  const downloaded = settledModel || model.phase === "decode" || model.phase === "render" ? 1 : model.totalBytes ? Math.min(1, (model.loadedBytes || 0) / model.totalBytes) : 0;
  // Resource preparation units: decoded artwork, fonts, model transfer, first frame.
  // This is not a claim about the combined byte size of the application.
  const progress = unknownDownload && assets.completed === totalAssets ? null : Math.min(1, (assets.completed + downloaded + (settledModel ? 1 : 0)) / (totalAssets + 2));

  useEffect(() => {
    if (phase !== "loading") return;
    const timer = setTimeout(() => setSlow(true), 12000);
    return () => clearTimeout(timer);
  }, [phase, attempt]);

  useEffect(() => {
    if (phase === "loading" && ready && !degraded) setPhase(reducedMotion ? "complete" : "leaving");
  }, [phase, ready, degraded, reducedMotion]);

  useEffect(() => {
    if (phase !== "leaving") return;
    if (reducedMotion) { setPhase("complete"); return; }
    const timer = setTimeout(() => setPhase("complete"), 360);
    return () => clearTimeout(timer);
  }, [phase, reducedMotion]);

  const continueToMenu = useCallback(() => setPhase(reducedMotion ? "complete" : "leaving"), [reducedMotion]);
  const retry = useCallback(() => {
    // A fresh document retries failed images and font faces as well as their UI nodes.
    if (assets.failures.length) { window.location.reload(); return; }
    setModel(firstModel);
    setSlow(false);
    setAttempt(value => value + 1);
    setPhase("loading");
  }, [assets.failures.length]);

  let status = "Preparing the menu";
  if (degraded && ready) status = model.error ? "The menu is ready with an illustrated sorcerer." : "The menu is ready. Some artwork or fonts could not load.";
  else if (model.status === "loading" && model.phase === "decode") status = "Preparing the sorcerer";
  else if (model.status === "loading" && model.phase === "render") status = "Preparing the first frame";
  else if (model.status === "loading" && model.totalBytes) status = `Loading the sorcerer · ${((model.loadedBytes || 0) / 1048576).toFixed(1)} / ${(model.totalBytes / 1048576).toFixed(1)} MB`;
  else if (model.status === "loading") status = "Loading the sorcerer";
  else if (assets.completed < totalAssets) status = "Preparing artwork and type";
  else if (ready) status = "The board awaits";
  if (slow && !ready) status = "Still preparing the menu. You can continue while it finishes.";

  return { blocking: phase !== "complete", visible: phase !== "complete", leaving: phase === "leaving", ready, typeReady, degraded, progress, status, attempt, model, canContinue: degraded && ready || slow, onModelState, continueToMenu, retry };
}
