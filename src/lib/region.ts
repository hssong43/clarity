export type RegionSelection = { x: number; y: number; width: number; height: number };

type Point = { x: number; y: number };
type Rect = { left: number; top: number; width: number; height: number };

/** Minimum drag, in CSS pixels, before a selection counts. */
export const MIN_SELECTION_PX = 8;

/** Largest size with the image's aspect ratio that fits the viewport. */
export function fitWithin(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return { width: width * scale, height: height * scale };
}

/** The dragged rectangle in pixels, clamped to the image. */
export function selectionBox(start: Point, end: Point, image: Rect): Rect {
  const clampX = (value: number) => Math.min(Math.max(value, image.left), image.left + image.width);
  const clampY = (value: number) => Math.min(Math.max(value, image.top), image.top + image.height);
  const left = clampX(Math.min(start.x, end.x));
  const top = clampY(Math.min(start.y, end.y));
  return {
    left,
    top,
    width: clampX(Math.max(start.x, end.x)) - left,
    height: clampY(Math.max(start.y, end.y)) - top
  };
}

/** Converts a pixel box over the displayed image into fractions of the image. */
export function toFractions(box: Rect, image: Rect): RegionSelection | null {
  if (box.width < MIN_SELECTION_PX || box.height < MIN_SELECTION_PX) {
    return null;
  }
  if (image.width <= 0 || image.height <= 0) {
    return null;
  }
  return {
    x: (box.left - image.left) / image.width,
    y: (box.top - image.top) / image.height,
    width: box.width / image.width,
    height: box.height / image.height
  };
}
