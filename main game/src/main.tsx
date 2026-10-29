import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyMenuTheme } from "./theme";
import "./styles.css";

applyMenuTheme();

// Optional seam owned by the Legacy environment workflow (docs/legacy/WORKFLOWS.md):
// ?legacyEnvironment mounts the Bannerhold environment harness with labelled fixtures.
const environmentHarness = import.meta.glob<{ mountLegacyEnvironmentHarness: (root: HTMLElement) => void }>("./legacy/environment/harness.ts");
const loadHarness = new URLSearchParams(window.location.search).has("legacyEnvironment") ? Object.values(environmentHarness)[0] : undefined;
const root = document.getElementById("root")!;

if (loadHarness) void loadHarness().then((module) => module.mountLegacyEnvironmentHarness(root));
else ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
