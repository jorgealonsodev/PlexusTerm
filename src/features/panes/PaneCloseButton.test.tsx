// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaneCloseButton } from "./PaneCloseButton";

afterEach(cleanup);

describe("PaneCloseButton", () => {
  it("shows the × only while the pointer is in the corner, and closes the pane", () => {
    const onClose = vi.fn();
    const { container } = render(<PaneCloseButton onClose={onClose} />);
    const corner = container.querySelector(".pane__corner")!;
    expect(screen.queryByRole("button", { name: "Close pane" })).toBeNull();
    fireEvent.mouseEnter(corner);
    fireEvent.click(screen.getByRole("button", { name: "Close pane" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseLeave(corner);
    expect(screen.queryByRole("button", { name: "Close pane" })).toBeNull();
  });
});
