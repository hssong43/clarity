import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { RegionSelector } from "./components/RegionSelector";
import { getNativeGlassKind } from "./lib/tauri";
import "./styles.css";

// The region selector window loads the same bundle at index.html#region.
const isRegionWindow = window.location.hash === "#region";

// Lets the stylesheet thin out its own glass when the OS draws the real material.
void getNativeGlassKind().then((kind) => {
  if (kind !== "none") {
    document.documentElement.dataset.nativeGlass = kind;
  }
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isRegionWindow ? <RegionSelector /> : <App />}</React.StrictMode>
);
