/** Renderer names of WebGL drawn by the processor: every frame of the terminal would be slow. */
const SOFTWARE = /llvmpipe|softpipe|swiftshader|software/i;

let known: boolean | null = null;
/** What the probe found, for the diagnostic log. */
let found = "not probed yet";

/**
 * Whether WebGL here is drawn in software (WebKitGTK falls back to llvmpipe without a usable GPU):
 * xterm's own renderer is faster then. Asked once, with a context that is released at once.
 */
export function softwareWebgl(): boolean {
  if (known !== null) return known;
  known = false;
  try {
    const gl = document.createElement("canvas").getContext("webgl2") as WebGL2RenderingContext | null;
    if (!gl) {
      found = "WebGL2 unavailable";
      return known;
    }
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    known = SOFTWARE.test(renderer);
    found = `WebGL2 renderer "${renderer || "unknown"}"${known ? " (software: xterm's renderer is used)" : ""}`;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  } catch (error) {
    // Cannot tell: WebGL is tried, and falls back by itself if it fails.
    found = `WebGL2 probe failed: ${String(error)}`;
  }
  return known;
}

/** The renderer the probe found, or why there is none (probing first if needed). */
export function webglDescription(): string {
  softwareWebgl();
  return found;
}

/** Forgets the answer (tests). */
export function forgetWebglProbe() {
  known = null;
  found = "not probed yet";
}
