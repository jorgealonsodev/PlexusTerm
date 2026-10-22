import { BASE_PANE_FOOTER_HEIGHT } from "../settings/settings";

/** The bars' text and icons grow with them, up to this many times their size at the default height. */
export const MAX_PANE_FOOTER_TEXT_SCALE = 1.6;

/** How much the text of a bar `height` px tall is scaled (1 at the default height). */
export const paneFooterTextScale = (height: number) =>
  Math.min(MAX_PANE_FOOTER_TEXT_SCALE, height / BASE_PANE_FOOTER_HEIGHT);

/** Sets the height of the bars under the panes (App.css: --pane-footer-height, --pane-footer-scale). */
export function applyPaneFooterHeight(height: number) {
  const root = document.documentElement.style;
  root.setProperty("--pane-footer-height", `${height}px`);
  root.setProperty("--pane-footer-scale", String(paneFooterTextScale(height)));
}
