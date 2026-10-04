import { useEffect } from "react";
import {
  bindOverlayPositionPersistence,
  restoreOverlayPosition,
  setOverlayMode
} from "../lib/tauri";

export function useOverlayWindow(showPill: boolean) {
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void restoreOverlayPosition();
    void bindOverlayPositionPersistence().then((nextUnlisten) => {
      unlisten = nextUnlisten;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const shouldUsePanel = !showPill;
    void setOverlayMode(shouldUsePanel ? "panel" : "pill");
  }, [showPill]);
}
