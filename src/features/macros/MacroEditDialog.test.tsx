// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MacroEditDialog } from "./MacroEditDialog";
import type { Macro } from "./macros";

const macro: Macro = {
  id: "m1",
  name: "Login",
  steps: [
    { kind: "send", text: "ssh h\\r" },
    { kind: "waitFor", text: "password:", timeoutSec: 10 },
  ],
};
const other: Macro = { id: "m2", name: "Deploy", hotkey: 4, steps: [] };

function renderDialog() {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(<MacroEditDialog macro={macro} isNew={false} macros={[macro, other]} onSave={onSave} onCancel={onCancel} />);
  return { onSave, onCancel };
}

const steps = () => screen.getAllByRole("listitem");

afterEach(cleanup);

describe("MacroEditDialog (S16.4)", () => {
  it("edits name, hotkey and steps: add, edit, reorder, remove", () => {
    const { onSave } = renderDialog();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Login prod" } });
    const hotkey = screen.getByLabelText("Hotkey") as HTMLSelectElement;
    // The option shows who uses the hotkey now; choosing it moves the hotkey.
    expect(within(hotkey).getByRole("option", { name: "Ctrl+Alt+4 (Deploy)" })).toBeTruthy();
    fireEvent.change(hotkey, { target: { value: "4" } });

    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    const added = steps()[2];
    fireEvent.change(within(added).getByLabelText("Step 3 kind"), { target: { value: "wait" } });
    fireEvent.change(within(added).getByLabelText("Step 3 milliseconds"), { target: { value: "500" } });
    fireEvent.click(within(added).getByRole("button", { name: "Move step 3 up" }));
    fireEvent.click(within(steps()[0]).getByRole("button", { name: "Remove step 1" }));
    fireEvent.change(within(steps()[1]).getByLabelText("Step 2 timeout in seconds"), { target: { value: "30" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({
      id: "m1",
      name: "Login prod",
      hotkey: 4,
      steps: [
        { kind: "wait", ms: 500 },
        { kind: "waitFor", text: "password:", timeoutSec: 30 },
      ],
    });
  });

  it("shows validation errors instead of saving", () => {
    const { onSave } = renderDialog();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter a name.");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("cancels", () => {
    const { onCancel } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("explains that {{name}} asks for a value when the macro plays (S4)", () => {
    renderDialog();
    expect(screen.getByText(/\{\{name\}\} in a text asks for its value each time the macro plays/)).toBeTruthy();
  });
});
