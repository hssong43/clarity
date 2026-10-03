import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { finishRegionCapture, getRegionPreviews } from "../lib/tauri";
import { RegionSelector } from "./RegionSelector";

vi.mock("../lib/tauri", () => ({
  getRegionPreviews: vi.fn(),
  finishRegionCapture: vi.fn(async () => undefined)
}));

const preview = (displayId: string, isDefault: boolean) => ({
  displayId,
  dataUrl: "data:image/jpeg;base64,AA",
  width: 1920,
  height: 1080,
  isDefault
});

// jsdom has no PointerEvent, so pointer coordinates would be dropped.
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}
vi.stubGlobal("PointerEvent", TestPointerEvent);

beforeEach(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Object.assign(window, { innerWidth: 1280, innerHeight: 800 });
  vi.mocked(finishRegionCapture).mockClear();
  vi.mocked(getRegionPreviews).mockResolvedValue([preview("1", false), preview("2", true)]);
});

async function renderSelector() {
  await act(async () => {
    render(<RegionSelector />);
  });
  return document.querySelector<HTMLElement>(".region-selector")!;
}

describe("RegionSelector", () => {
  it("opens on the default display and sends the dragged region as fractions", async () => {
    const surface = await renderSelector();
    expect(screen.getByRole("button", { name: "Display 2" })).toHaveClass("is-active");

    fireEvent.pointerDown(surface, { button: 0, clientX: 300, clientY: 220, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: 700, clientY: 480, pointerId: 1 });
    fireEvent.pointerUp(surface, { button: 0, clientX: 700, clientY: 480, pointerId: 1 });

    expect(finishRegionCapture).toHaveBeenCalledWith("2", {
      x: 0.234375,
      y: 0.25,
      width: 0.3125,
      height: 260 / 720
    });
  });

  it("ignores clicks without a drag", async () => {
    const surface = await renderSelector();

    fireEvent.pointerDown(surface, { button: 0, clientX: 300, clientY: 220, pointerId: 1 });
    fireEvent.pointerUp(surface, { button: 0, clientX: 302, clientY: 221, pointerId: 1 });

    expect(finishRegionCapture).not.toHaveBeenCalled();
  });

  it("cancels on Escape", async () => {
    await renderSelector();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(finishRegionCapture).toHaveBeenCalledWith(null, null);
  });
});
