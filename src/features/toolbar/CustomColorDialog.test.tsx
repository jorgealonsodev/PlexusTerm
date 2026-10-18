// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomColorDialog } from "./CustomColorDialog";

afterEach(() => {
  cleanup();
  delete (window as { EyeDropper?: unknown }).EyeDropper;
});

const accept = () => screen.getByRole("button", { name: "Accept" });

describe("custom colour", () => {
  it("starts from the colour in use and accepts a typed code, the Accept button painted with it", () => {
    const onAccept = vi.fn();
    render(<CustomColorDialog initial="#2e86de" pickFromScreen={null} onAccept={onAccept} onCancel={() => {}} />);
    const code = screen.getByRole("textbox", { name: "Colour code" }) as HTMLInputElement;
    expect(code.value).toBe("#2e86de");
    expect(accept().style.background).toBe("rgb(46, 134, 222)");
    fireEvent.change(code, { target: { value: "#FFEE00" } });
    expect(accept().style.background).toBe("rgb(255, 238, 0)");
    // Dark text on a light colour, light text on a dark one.
    expect(accept().style.color).toBe("rgb(0, 0, 0)");
    fireEvent.click(accept());
    expect(onAccept).toHaveBeenCalledWith("#ffee00");
  });

  it("refuses a code that is not a colour", () => {
    render(<CustomColorDialog initial="#2e86de" pickFromScreen={null} onAccept={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Colour code" }), { target: { value: "#12" } });
    expect((accept() as HTMLButtonElement).disabled).toBe(true);
  });

  it("takes the system picker's colour", () => {
    render(<CustomColorDialog initial="#2e86de" pickFromScreen={null} onAccept={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Choose a colour"), { target: { value: "#123456" } });
    expect((screen.getByRole("textbox", { name: "Colour code" }) as HTMLInputElement).value).toBe("#123456");
  });

  it("picks a colour anywhere on the screen, and keeps the colour when picking is cancelled", async () => {
    const pick = vi.fn<() => Promise<string | null>>().mockResolvedValueOnce("#abcdef").mockResolvedValueOnce(null);
    render(<CustomColorDialog initial="#2e86de" pickFromScreen={pick} onAccept={() => {}} onCancel={() => {}} />);
    const code = screen.getByRole("textbox", { name: "Colour code" }) as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "Pick from the screen" }));
    await waitFor(() => expect(code.value).toBe("#abcdef"));
    fireEvent.click(screen.getByRole("button", { name: "Pick from the screen" }));
    await waitFor(() => expect(pick).toHaveBeenCalledTimes(2));
    expect(code.value).toBe("#abcdef");
  });

  it("has no screen picker where the system offers none, and cancels with its button and Escape", () => {
    const onCancel = vi.fn();
    render(<CustomColorDialog initial={null} pickFromScreen={null} onAccept={() => {}} onCancel={onCancel} />);
    expect(screen.queryByRole("button", { name: "Pick from the screen" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
