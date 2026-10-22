// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetWebglProbe, softwareWebgl, webglDescription } from "./webglProbe";

const RENDERER = 0x9246;
const fakeGl = (renderer: string) => {
  const lose = vi.fn();
  return {
    lose,
    gl: {
      getExtension: (name: string) =>
        name === "WEBGL_debug_renderer_info"
          ? { UNMASKED_RENDERER_WEBGL: RENDERER }
          : name === "WEBGL_lose_context"
            ? { loseContext: lose }
            : null,
      getParameter: (p: number) => (p === RENDERER ? renderer : ""),
    },
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  forgetWebglProbe();
});

describe("softwareWebgl", () => {
  it("is true for software renderers, which make every frame slow", () => {
    for (const renderer of ["llvmpipe (LLVM 15.0.7, 256 bits)", "Google SwiftShader", "Software Rasterizer"]) {
      forgetWebglProbe();
      const { gl, lose } = fakeGl(renderer);
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(gl as never);
      expect(softwareWebgl(), renderer).toBe(true);
      expect(lose).toHaveBeenCalled();
    }
  });

  it("is false for a GPU, and when it cannot tell", () => {
    const { gl } = fakeGl("Mesa Intel(R) UHD Graphics 620 (KBL GT2)");
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(gl as never);
    expect(softwareWebgl()).toBe(false);
    forgetWebglProbe();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(softwareWebgl()).toBe(false);
  });

  it("describes the renderer it found for the diagnostic log", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(fakeGl("Mesa Intel(R) UHD 620").gl as never);
    expect(webglDescription()).toBe('WebGL2 renderer "Mesa Intel(R) UHD 620"');
    forgetWebglProbe();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(fakeGl("llvmpipe").gl as never);
    expect(webglDescription()).toBe(`WebGL2 renderer "llvmpipe" (software: xterm's renderer is used)`);
    forgetWebglProbe();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(webglDescription()).toBe("WebGL2 unavailable");
  });

  it("asks once and remembers the answer", () => {
    const { gl } = fakeGl("llvmpipe");
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(gl as never);
    softwareWebgl();
    softwareWebgl();
    expect(getContext).toHaveBeenCalledTimes(1);
  });
});
