import { describe, expect, it } from "vitest";
import { fitWithin, selectionBox, toFractions } from "./region";

const image = { left: 100, top: 50, width: 800, height: 400 };

describe("region selection math", () => {
  it("fits screenshots inside the viewport without distortion", () => {
    expect(fitWithin(3840, 2160, 1920, 1200)).toEqual({ width: 1920, height: 1080 });
    expect(fitWithin(1000, 2000, 1000, 1000)).toEqual({ width: 500, height: 1000 });
    expect(fitWithin(0, 100, 1000, 1000)).toEqual({ width: 0, height: 0 });
  });

  it("normalizes drags in any direction", () => {
    const box = selectionBox({ x: 500, y: 250 }, { x: 300, y: 150 }, image);
    expect(box).toEqual({ left: 300, top: 150, width: 200, height: 100 });
    expect(toFractions(box, image)).toEqual({ x: 0.25, y: 0.25, width: 0.25, height: 0.25 });
  });

  it("clamps drags that leave the image", () => {
    const box = selectionBox({ x: 0, y: 0 }, { x: 2000, y: 2000 }, image);
    expect(toFractions(box, image)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("ignores clicks and tiny drags", () => {
    expect(toFractions(selectionBox({ x: 200, y: 200 }, { x: 203, y: 260 }, image), image)).toBe(
      null
    );
  });
});
