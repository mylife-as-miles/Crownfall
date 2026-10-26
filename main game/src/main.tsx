import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyMenuTheme } from "./theme";
import "./styles.css";

applyMenuTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
