// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { language } from "@codemirror/language";
import { FileViewer } from "./FileViewer";

afterEach(cleanup);

const file = (content: string, truncated = false) => async () => ({ path: "/p/x", content, truncated });

const editorView = () => {
  const dom = document.querySelector<HTMLElement>(".cm-editor");
  if (!dom) throw new Error("no editor");
  return EditorView.findFromDOM(dom)!;
};

describe("FileViewer code view (S2, S3, S5)", () => {
  it("shows the file read-only, with line numbers and long lines wrapped", async () => {
    render(<FileViewer path="/p/notes.txt" load={file("one\ntwo\nthree")} onClose={() => {}} />);
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("onetwothree"));
    const numbers = [...document.querySelectorAll(".cm-lineNumbers .cm-gutterElement")].map((e) => e.textContent);
    expect(numbers).toEqual(expect.arrayContaining(["1", "2", "3"]));
    const view = editorView();
    expect(view.state.readOnly).toBe(true);
    expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(true);
    // Nothing changes the text.
    act(() => view.dispatch({ changes: { from: 0, insert: "x" } }));
    expect(view.state.doc.toString()).toBe("one\ntwo\nthree");
    expect(screen.getByRole("heading", { name: "notes.txt" }).getAttribute("title")).toBe("/p/notes.txt");
  });

  it("highlights the language its name says, and leaves unknown files plain", async () => {
    const { unmount } = render(<FileViewer path="/p/main.ts" load={file("const a: number = 1;")} onClose={() => {}} />);
    await waitFor(() => expect(editorView().state.facet(language)?.name).toBe("typescript"));
    unmount();
    render(<FileViewer path="/p/data.unknownext" load={file("plain")} onClose={() => {}} />);
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("plain"));
    await new Promise((r) => setTimeout(r, 20));
    expect(editorView().state.facet(language)).toBeNull();
  });

  it("says when only the start of a long file is shown, and why a file cannot be shown", async () => {
    const { unmount } = render(<FileViewer path="/p/big.log" load={file("start", true)} onClose={() => {}} />);
    expect((await screen.findByRole("note")).textContent).toContain("first 4 MB");
    unmount();
    const failing = vi.fn(async () => {
      throw "cannot view /p/a.bin: it is not a text file";
    });
    render(<FileViewer path="/p/a.bin" load={failing} onClose={() => {}} />);
    expect((await screen.findByRole("alert")).textContent).toBe("cannot view /p/a.bin: it is not a text file");
    expect(document.querySelector(".cm-editor")).toBeNull();
  });

  it("closes with its button", async () => {
    const onClose = vi.fn();
    render(<FileViewer path="/p/notes.txt" load={file("x")} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close viewer" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("reads the file again when it is given another one", async () => {
    const { rerender } = render(<FileViewer path="/p/a.txt" load={file("first")} onClose={() => {}} />);
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("first"));
    rerender(<FileViewer path="/p/b.txt" load={file("second")} onClose={() => {}} />);
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("second"));
  });
});
