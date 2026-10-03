import { useCallback, useEffect, useState } from "react";
import { fitWithin, selectionBox, toFractions } from "../lib/region";
import { finishRegionCapture, getRegionPreviews, type RegionPreview } from "../lib/tauri";

type Point = { x: number; y: number };

/** Full-screen window for dragging a rectangle over a frozen screenshot. */
export function RegionSelector() {
  const [previews, setPreviews] = useState<RegionPreview[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }));
  const [drag, setDrag] = useState<{ start: Point; end: Point } | null>(null);

  const cancel = useCallback(() => {
    void finishRegionCapture(null, null);
  }, []);

  useEffect(() => {
    void getRegionPreviews()
      .then((nextPreviews) => {
        setPreviews(nextPreviews);
        setActiveIndex(
          Math.max(
            0,
            nextPreviews.findIndex((preview) => preview.isDefault)
          )
        );
      })
      .catch((reason: unknown) => setError(String(reason)));
  }, []);

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cancel();
      }
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [cancel]);

  const preview = previews[activeIndex];
  const fitted = preview
    ? fitWithin(preview.width, preview.height, viewport.width, viewport.height)
    : { width: 0, height: 0 };
  const imageRect = {
    left: (viewport.width - fitted.width) / 2,
    top: (viewport.height - fitted.height) / 2,
    width: fitted.width,
    height: fitted.height
  };
  const box = drag ? selectionBox(drag.start, drag.end, imageRect) : null;

  const finishDrag = () => {
    if (!preview || !box) {
      return;
    }
    const selection = toFractions(box, imageRect);
    setDrag(null);
    if (selection) {
      void finishRegionCapture(preview.displayId, selection);
    }
  };

  return (
    <div
      className="region-selector"
      onPointerDown={(event) => {
        if (event.button !== 0 || !preview) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const point = { x: event.clientX, y: event.clientY };
        setDrag({ start: point, end: point });
      }}
      onPointerMove={(event) => {
        if (!drag) return;
        setDrag({ ...drag, end: { x: event.clientX, y: event.clientY } });
      }}
      onPointerUp={finishDrag}
      onPointerCancel={() => setDrag(null)}
      onContextMenu={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      {preview ? (
        <img
          className="region-image"
          src={preview.dataUrl}
          alt=""
          draggable={false}
          style={imageRect}
        />
      ) : null}
      <div className={`region-dim ${box ? "is-hidden" : ""}`} />
      {box ? <div className="region-box" style={box} /> : null}

      <div className="region-toolbar" onPointerDown={(event) => event.stopPropagation()}>
        {previews.length > 1
          ? previews.map((candidate, index) => (
              <button
                key={candidate.displayId}
                type="button"
                className={index === activeIndex ? "is-active" : ""}
                onClick={() => setActiveIndex(index)}
              >
                Display {index + 1}
              </button>
            ))
          : null}
        <span>{error ?? "Drag to select a region · Esc to cancel"}</span>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
