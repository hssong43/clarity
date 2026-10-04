import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { RegionSelector } from "./components/RegionSelector";
import { SelectionFrame } from "./components/SelectionFrame";
import { getNativeGlassKind } from "./lib/tauri";
import "./styles.css";

// The region selector and the drag-selection outline load the same bundle at
// index.html#region and index.html#selection.
const view = window.location.hash;

// Lets the stylesheet thin out its own glass when the OS draws the real material.
void getNativeGlassKind().then((kind) => {
  if (kind !== "none") {
    document.documentElement.dataset.nativeGlass = kind;
  }
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {view === "#region" ? <RegionSelector /> : view === "#selection" ? <SelectionFrame /> : <App />}
  </React.StrictMode>
);
