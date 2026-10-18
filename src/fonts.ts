/**
 * Hack, bundled under its own family name ("Hack Web") so it never replaces a Hack installed on the
 * computer. Its package's CSS cannot be used as is: it names the family "Hack" and its subset file
 * points to a font file that does not exist. The full files keep the box-drawing and Powerline glyphs.
 */
import hackRegular from "hack-font/build/web/fonts/hack-regular.woff2?url";
import hackBold from "hack-font/build/web/fonts/hack-bold.woff2?url";

export function registerHack() {
  if (typeof FontFace === "undefined" || !document.fonts) return;
  for (const [url, weight] of [
    [hackRegular, "400"],
    [hackBold, "700"],
  ]) {
    document.fonts.add(new FontFace("Hack Web", `url(${url}) format("woff2")`, { weight, display: "swap" }));
  }
}
