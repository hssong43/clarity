import { useRef } from "react";
import { Sparkles } from "lucide-react";
import type { FileDropHandlers } from "../hooks/useFileDrop";
import { startOverlayDrag } from "../lib/tauri";

const PILL_DRAG_MOVE_PX = 4;

export function Pill({
  isDropTarget,
  dropHandlers,
  onExpand
}: {
  isDropTarget: boolean;
  dropHandlers: FileDropHandlers;
  onExpand: () => void;
}) {
  const pressStartRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const dragStartedRef = useRef(false);

  const startPress = (x: number, y: number, pointerId: number) => {
    pressStartRef.current = { x, y, pointerId };
    dragStartedRef.current = false;
  };

  const maybeStartDrag = (x: number, y: number) => {
    const start = pressStartRef.current;
    if (!start || dragStartedRef.current) {
      return;
    }

    if (Math.hypot(x - start.x, y - start.y) >= PILL_DRAG_MOVE_PX) {
      dragStartedRef.current = true;
      pressStartRef.current = null;
      void startOverlayDrag().catch(() => {
        dragStartedRef.current = false;
      });
    }
  };

  const finishPress = () => {
    const wasDrag = dragStartedRef.current;
    pressStartRef.current = null;
    dragStartedRef.current = false;
    if (!wasDrag) {
      onExpand();
    }
  };

  const cancelPress = () => {
    pressStartRef.current = null;
    dragStartedRef.current = false;
  };

  return (
    <div
      className={`pill glass-pill ${isDropTarget ? "is-drop-target" : ""}`}
      role="button"
      tabIndex={0}
      aria-label="Clarity overlay"
      {...dropHandlers}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        startPress(event.clientX, event.clientY, event.pointerId);
      }}
      onPointerMove={(event) => {
        maybeStartDrag(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        if (event.button !== 0) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        finishPress();
      }}
      onPointerCancel={cancelPress}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onExpand();
        }
      }}
    >
      <span className="pill-glow" aria-hidden="true" />
      <span className="pill-mark" aria-hidden="true">
        <Sparkles size={15} />
      </span>
      <span className="pill-label">Clarity</span>
    </div>
  );
}
