import { useCallback, useEffect, useRef, useState } from "react";
import { loadCaptureShortcut, saveCaptureShortcut } from "../lib/shortcuts";
import { onCaptureShortcut, setCaptureShortcut } from "../lib/tauri";

export function useCaptureShortcut(onTrigger: () => void) {
  const [shortcut, setShortcut] = useState(() => loadCaptureShortcut());
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const onTriggerRef = useRef(onTrigger);

  useEffect(() => {
    onTriggerRef.current = onTrigger;
  });

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void onCaptureShortcut(() => onTriggerRef.current()).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    });
    void setCaptureShortcut(loadCaptureShortcut()).catch((error: unknown) => {
      setShortcutError(String(error));
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const updateShortcut = useCallback(
    async (next: string) => {
      try {
        await setCaptureShortcut(next);
        saveCaptureShortcut(next);
        setShortcut(next);
        setShortcutError(null);
      } catch (error) {
        setShortcutError(String(error));
        // Put the previous shortcut back; registering cleared it.
        await setCaptureShortcut(shortcut).catch(() => undefined);
      }
    },
    [shortcut]
  );

  return { shortcut, shortcutError, updateShortcut };
}
