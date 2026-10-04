import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { RegionSelector } from "./components/RegionSelector";
import "./styles.css";

// The region selector window loads the same bundle at index.html#region.
const isRegionWindow = window.location.hash === "#region";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isRegionWindow ? <RegionSelector /> : <App />}</React.StrictMode>
);
