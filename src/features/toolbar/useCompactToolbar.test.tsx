// @vitest-environment jsdom
import { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCompactToolbar } from "./compact";

afterEach(cleanup);

/** jsdom has no layout: a button is as wide as its icon (24px) and label, or its --btn-min if larger. */
function fakeLayout() {
  const labelWidth = (el: HTMLElement) => (el.textContent ?? "").length * 8;
  const spies = [
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      if (!this.classList.contains("btn")) return 0;
      const label = this.querySelector<HTMLElement>(".btn__label")!;
      const min = Number.parseFloat(this.style.getPropertyValue("--btn-min")) || 0;
      return Math.max(24 + labelWidth(label), min);
    }),
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("btn__label") ? labelWidth(this) : 1000;
    }),
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("btn__label") ? labelWidth(this) : 500;
    }),
  ];
  return () => spies.forEach((s) => s.mockRestore());
}

function Toolbar() {
  const ref = useRef<HTMLElement>(null);
  useCompactToolbar(ref);
  return (
    <header ref={ref}>
      <button className="btn btn--icon">
        <span className="btn__label">SSH</span>
      </button>
    </header>
  );
}

describe("useCompactToolbar", () => {
  it("keeps a short label's minimum width the same however often the window is resized", () => {
    let resize: () => void = () => {};
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) {
        resize = cb;
      }
      observe() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    const restore = fakeLayout();
    try {
      const { container } = render(<Toolbar />);
      const button = container.querySelector<HTMLElement>(".btn")!;
      const first = button.style.getPropertyValue("--btn-min");
      expect(first).toBe("49px");
      for (let i = 0; i < 20; i++) act(() => resize());
      expect(button.style.getPropertyValue("--btn-min")).toBe(first);
    } finally {
      restore();
      globalThis.ResizeObserver = original;
    }
  });
});
