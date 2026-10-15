// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MultiExecBanner } from "./MultiExecBanner";

afterEach(cleanup);

describe("MultiExecBanner", () => {
  it("shows how many terminals receive the input and turns multi-execution off", () => {
    const onTurnOff = vi.fn();
    render(<MultiExecBanner count={3} onTurnOff={onTurnOff} />);
    expect(screen.getByRole("status").textContent).toContain("Multi-execution ON — input goes to 3 terminals");
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(onTurnOff).toHaveBeenCalledTimes(1);
  });

  it("uses the singular for one terminal", () => {
    render(<MultiExecBanner count={1} onTurnOff={() => {}} />);
    expect(screen.getByRole("status").textContent).toContain("input goes to 1 terminal");
    expect(screen.getByRole("status").textContent).not.toContain("1 terminals");
  });
});
