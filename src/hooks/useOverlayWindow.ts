import { useEffect } from "react";
import { setOverlayMode } from "../lib/tauri";

/** Shows the small cursor-following orb while idle and the full panel otherwise. */
export function useOverlayWindow(showOrb: boolean) {
  useEffect(() => {
    void setOverlayMode(showOrb ? "orb" : "panel");
  }, [showOrb]);
}
