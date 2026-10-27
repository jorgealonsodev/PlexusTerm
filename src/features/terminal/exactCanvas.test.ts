// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { keepCanvasesExact } from "./exactCanvas";

/** xterm's screen with a WebGL canvas the size xterm gives it, rounded to whole CSS pixels. */
const screenWith = (width: number, height: number, ratio: number) => {
  const root = document.createElement("div");
  const screen = document.createElement("div");
  screen.className = "xterm-screen";
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${Math.round(width / ratio)}px`;
  canvas.style.height = `${Math.round(height / ratio)}px`;
  // xterm's glyph atlas: a canvas with no CSS size, never shown.
  const atlas = document.createElement("canvas");
  atlas.width = 44;
  atlas.height = 30;
  screen.append(canvas, atlas);
  root.append(screen);
  return { root, canvas, atlas };
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("keepCanvasesExact", () => {
  it("gives the canvas the CSS size of its buffer at a fractional ratio (Xft.dpi 110)", () => {
    const ratio = 110 / 96;
    const { root, canvas, atlas } = screenWith(830, 638, ratio);
    const stop = keepCanvasesExact(root, () => ratio);
    expect(parseFloat(canvas.style.width) * ratio).toBeCloseTo(830, 3);
    expect(parseFloat(canvas.style.height) * ratio).toBeCloseTo(638, 3);
    expect(atlas.style.width).toBe("");
    stop();
  });

  it("fixes it again when xterm resizes it, and stops when told to", async () => {
    const ratio = 110 / 96;
    const { root, canvas } = screenWith(830, 638, ratio);
    const stop = keepCanvasesExact(root, () => ratio);
    canvas.height = 968;
    canvas.style.height = "845px";
    await settle();
    expect(parseFloat(canvas.style.height) * ratio).toBeCloseTo(968, 3);
    stop();
    canvas.style.height = "557px";
    await settle();
    expect(canvas.style.height).toBe("557px");
  });

  it("leaves the canvas alone at a whole ratio, where xterm's size is already exact", () => {
    const { root, canvas } = screenWith(1600, 1200, 2);
    keepCanvasesExact(root, () => 2)();
    expect(canvas.style.width).toBe("800px");
    expect(canvas.style.height).toBe("600px");
  });
});
