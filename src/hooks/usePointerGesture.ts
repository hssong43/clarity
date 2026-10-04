import { useCallback, useEffect, useRef, useState } from "react";
import { loadPointerModifier, savePointerModifier, type PointerModifier } from "../lib/pointer";
import { onPointerCapture, setPointerModifier, type PointerCaptureEvent } from "../lib/tauri";

/** Modifier + click / drag gestures from the native layer, plus the chosen modifier. */
export function usePointerGesture(onGesture: (event: PointerCaptureEvent) => void) {
  const [modifier, setModifier] = useState<PointerModifier>(() => loadPointerModifier());
  const onGestureRef = useRef(onGesture);

  useEffect(() => {
    onGestureRef.current = onGesture;
  });

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void onPointerCapture((event) => onGestureRef.current(event)).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    });
    void setPointerModifier(loadPointerModifier()).catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const updateModifier = useCallback((next: PointerModifier) => {
    setModifier(next);
    savePointerModifier(next);
    void setPointerModifier(next).catch(() => undefined);
  }, []);

  return { modifier, updateModifier };
}
