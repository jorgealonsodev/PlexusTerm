// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DialogProvider, useDialogs, type Dialogs } from "./DialogProvider";

afterEach(cleanup);

/** Renders the provider and hands out its API. */
function setup() {
  let api: Dialogs | null = null;
  function Grab() {
    api = useDialogs();
    return null;
  }
  render(
    <DialogProvider>
      <Grab />
    </DialogProvider>,
  );
  return api as unknown as Dialogs;
}

/** Starts a request and lets the dialog render; the answer is in `.done`. */
const ask = async <T,>(start: () => Promise<T>) => {
  let done: Promise<T> = Promise.resolve(undefined as T);
  await act(async () => {
    done = start();
  });
  return { done };
};

const answer = async (name: string) => {
  await act(async () => void fireEvent.click(screen.getByRole("button", { name })));
};

describe("confirm", () => {
  it("shows the message as paragraphs and resolves true when accepted", async () => {
    const dialogs = setup();
    const result = await ask(() =>
      dialogs.confirm({ title: "Delete session", message: "Delete it?\n\nUsed as a jump host.", confirmLabel: "Delete", danger: true }),
    );
    const dialog = screen.getByRole("alertdialog", { name: "Delete session" });
    expect(dialog.closest(".overlay")).not.toBeNull();
    expect(dialog.classList.contains("dialog")).toBe(true);
    expect([...dialog.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["Delete it?", "Used as a jump host."]);
    await answer("Delete");
    expect(await result.done).toBe(true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("resolves false on Cancel and on Escape", async () => {
    const dialogs = setup();
    const first = await ask(() => dialogs.confirm({ message: "Replace a.txt?", confirmLabel: "Replace" }));
    await answer("Cancel");
    expect(await first.done).toBe(false);
    const second = await ask(() => dialogs.confirm({ message: "Replace a.txt?", confirmLabel: "Replace" }));
    await act(async () => void fireEvent.keyDown(screen.getByRole("dialog", { name: "Replace a.txt?" }), { key: "Escape" }));
    expect(await second.done).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("focuses the safe button for destructive confirmations and the action otherwise", async () => {
    const dialogs = setup();
    const first = await ask(() => dialogs.confirm({ message: "Delete x?", confirmLabel: "Delete", danger: true }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    await answer("Cancel");
    await first.done;
    const second = await ask(() => dialogs.confirm({ message: "Upload x?", confirmLabel: "Upload" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Upload" }));
    await answer("Upload");
    expect(await second.done).toBe(true);
  });

  it("shows one dialog at a time, in the order they were asked", async () => {
    const dialogs = setup();
    const a = await ask(() => dialogs.confirm({ message: "First?", confirmLabel: "Yes" }));
    const b = await ask(() => dialogs.confirm({ message: "Second?", confirmLabel: "Yes" }));
    expect(screen.getAllByRole("dialog").map((d) => d.getAttribute("aria-label"))).toEqual(["First?"]);
    await answer("Cancel");
    expect(await a.done).toBe(false);
    expect(screen.getByRole("dialog", { name: "Second?" })).toBeTruthy();
    await answer("Yes");
    expect(await b.done).toBe(true);
  });
});

describe("prompt", () => {
  it("submits the typed text with Enter and with the button", async () => {
    const dialogs = setup();
    const first = await ask(() => dialogs.prompt({ message: "New folder name", confirmLabel: "Create" }));
    const input = screen.getByRole("textbox", { name: "New folder name" }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: " docs " } });
    await act(async () => void fireEvent.keyDown(input, { key: "Enter" }));
    expect(await first.done).toBe(" docs ");

    const second = await ask(() =>
      dialogs.prompt({ message: 'Rename "a.txt" to', defaultValue: "a.txt", confirmLabel: "Rename" }),
    );
    expect((screen.getByRole("textbox", { name: 'Rename "a.txt" to' }) as HTMLInputElement).value).toBe("a.txt");
    await answer("Rename");
    expect(await second.done).toBe("a.txt");
  });

  it("resolves null on Cancel and on Escape", async () => {
    const dialogs = setup();
    const first = await ask(() => dialogs.prompt({ message: "New folder", confirmLabel: "Create" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    await answer("Cancel");
    expect(await first.done).toBeNull();
    const second = await ask(() => dialogs.prompt({ message: "New folder", confirmLabel: "Create" }));
    await act(async () => void fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" }));
    expect(await second.done).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("useDialogs", () => {
  it("needs a DialogProvider", () => {
    function Lonely() {
      useDialogs();
      return null;
    }
    const error = console.error;
    console.error = () => {};
    try {
      expect(() => render(<Lonely />)).toThrow("useDialogs needs a DialogProvider");
    } finally {
      console.error = error;
    }
  });
});
