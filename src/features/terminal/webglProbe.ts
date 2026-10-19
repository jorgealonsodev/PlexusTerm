/** Renderer names of WebGL drawn by the processor: every frame of the terminal would be slow. */
const SOFTWARE = /llvmpipe|softpipe|swiftshader|software/i;

let known: boolean | null = null;

/**
 * Whether WebGL here is drawn in software (WebKitGTK falls back to llvmpipe without a usable GPU):
 * xterm's own renderer is faster then. Asked once, with a context that is released at once.
 */
export function softwareWebgl(): boolean {
  if (known !== null) return known;
  known = false;
  try {
    const gl = document.createElement("canvas").getContext("webgl2") as WebGL2RenderingContext | null;
    if (!gl) return known;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    known = SOFTWARE.test(renderer);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    // Cannot tell: WebGL is tried, and falls back by itself if it fails.
  }
  return known;
}

/** Forgets the answer (tests). */
export function forgetWebglProbe() {
  known = null;
}
