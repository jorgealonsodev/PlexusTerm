/**
 * Keeps xterm's WebGL canvas at its exact CSS size. WebKitGTK turns the desktop's font DPI into a
 * fractional devicePixelRatio (Xft.dpi 110 gives 1.1458); xterm rounds the canvas's CSS size to
 * whole pixels, which leaves it a fraction of a pixel off its drawing buffer, and WebKit then
 * resamples the whole canvas: the text blurs, at some window heights only. At its exact size
 * (buffer ÷ ratio) every pixel of the buffer lands on one pixel of the screen.
 */

/** A size this close to the exact one is left alone (the style keeps 6 decimals). */
const TOLERANCE = 0.001;

/** Fixes the canvases in `root` now and whenever xterm resizes them; returns the function that stops. */
export function keepCanvasesExact(root: HTMLElement, ratio = () => window.devicePixelRatio): () => void {
  const fix = (canvas: HTMLCanvasElement) => {
    const r = ratio();
    // A whole ratio already maps exactly; a canvas without a set size is not on screen (a glyph atlas).
    if (!canvas.style.width || !canvas.style.height || !(r > 0) || Number.isInteger(r)) return;
    const width = canvas.width / r;
    const height = canvas.height / r;
    if (Math.abs(parseFloat(canvas.style.width) - width) > TOLERANCE) canvas.style.width = `${width}px`;
    if (Math.abs(parseFloat(canvas.style.height) - height) > TOLERANCE) canvas.style.height = `${height}px`;
  };
  const fixAll = () => root.querySelectorAll<HTMLCanvasElement>(".xterm-screen canvas").forEach(fix);
  const observer = new MutationObserver(fixAll);
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "width", "height"] });
  fixAll();
  return () => observer.disconnect();
}
