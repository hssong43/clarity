import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadCaptureShortcuts,
  saveCaptureShortcut,
  type CaptureArea,
  type CaptureShortcuts
} from "../lib/shortcuts";
import { onCaptureShortcut, setCaptureShortcuts } from "../lib/tauri";

export function useCaptureShortcuts(onTrigger: (area: CaptureArea) => void) {
  const [shortcuts, setShortcuts] = useState<CaptureShortcuts>(() => loadCaptureShortcuts());
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const onTriggerRef = useRef(onTrigger);

  useEffect(() => {
    onTriggerRef.current = onTrigger;
  });

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void onCaptureShortcut((area) => onTriggerRef.current(area)).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    });
    const saved = loadCaptureShortcuts();
    void setCaptureShortcuts(saved.full, saved.region).catch((error: unknown) => {
      setShortcutError(String(error));
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const updateShortcut = useCallback(
    async (area: CaptureArea, next: string) => {
      const candidate = { ...shortcuts, [area]: next };
      if (next && candidate.full === candidate.region) {
        setShortcutError("Use different keys for full-screen and region capture.");
        return;
      }
      try {
        await setCaptureShortcuts(candidate.full, candidate.region);
        saveCaptureShortcut(area, next);
        setShortcuts(candidate);
        setShortcutError(null);
      } catch (error) {
        setShortcutError(String(error));
        // Put the previous shortcuts back; registering cleared them.
        await setCaptureShortcuts(shortcuts.full, shortcuts.region).catch(() => undefined);
      }
    },
    [shortcuts]
  );

  return { shortcuts, shortcutError, updateShortcut };
}
