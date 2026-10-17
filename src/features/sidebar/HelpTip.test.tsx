// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HelpTip } from "./HelpTip";

afterEach(cleanup);

describe("HelpTip", () => {
  it("names its explanation and shows it on hover or focus until the pointer leaves", () => {
    render(<HelpTip text="Double-click a session to connect." />);
    const tip = screen.getByRole("button", { name: "Double-click a session to connect." });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseEnter(tip);
    expect(screen.getByRole("tooltip").textContent).toBe("Double-click a session to connect.");
    fireEvent.mouseLeave(tip);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(tip);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.keyDown(tip, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
