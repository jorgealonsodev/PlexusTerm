// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyPaneFooterHeight, paneFooterTextScale } from "./paneFooter";

describe("pane footer height", () => {
  it("grows the text with the bar up to 1.6 times its size", () => {
    expect(paneFooterTextScale(22)).toBe(1);
    expect(paneFooterTextScale(33)).toBe(1.5);
    expect(paneFooterTextScale(48)).toBe(1.6);
    applyPaneFooterHeight(44);
    const root = document.documentElement.style;
    expect(root.getPropertyValue("--pane-footer-height")).toBe("44px");
    expect(root.getPropertyValue("--pane-footer-scale")).toBe("1.6");
  });
});
