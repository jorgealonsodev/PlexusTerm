// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

describe("FileViewer Markdown (S4)", () => {
  it("shows a Markdown file rendered, with a switch to its code", async () => {
    render(<FileViewer path="/p/README.md" load={file("# Hello\n\nworld")} onClose={() => {}} />);
    const preview = await screen.findByRole("article");
    expect(preview.querySelector("h1")?.textContent).toBe("Hello");
    const code = screen.getByRole("radio", { name: "Code" });
    const rendered = screen.getByRole("radio", { name: "Preview" });
    expect(rendered.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(code);
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("# Helloworld"));
    expect(screen.queryByRole("article")).toBeNull();
    fireEvent.click(rendered);
    expect(await screen.findByRole("article")).toBeTruthy();
  });

  it("offers no switch for other files", async () => {
    render(<FileViewer path="/p/main.ts" load={file("x")} onClose={() => {}} />);
    await waitFor(() => expect(document.querySelector(".cm-content")).not.toBeNull());
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("opens web links in the system browser and never navigates the window", async () => {
    const onOpenLink = vi.fn();
    render(
      <FileViewer path="/p/README.md" load={file("[site](https://example.com) [mail](mailto:a@b.c) [rel](docs/x.md)")} onClose={() => {}} onOpenLink={onOpenLink} />,
    );
    const preview = await screen.findByRole("article");
    const click = (name: string) => {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      within(preview).getByText(name).dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(click("site")).toBe(true);
    expect(onOpenLink).toHaveBeenCalledWith("https://example.com/");
    expect(click("mail")).toBe(true);
    expect(click("rel")).toBe(true);
    expect(onOpenLink).toHaveBeenCalledTimes(1);
  });

  it("ignores broken web links and middle clicks on links", async () => {
    const onOpenLink = vi.fn();
    render(<FileViewer path="/p/README.md" load={file("[bad](http://) [site](https://example.com)")} onClose={() => {}} onOpenLink={onOpenLink} />);
    const preview = await screen.findByRole("article");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    expect(() => within(preview).getByText("bad").dispatchEvent(click)).not.toThrow();
    expect(click.defaultPrevented).toBe(true);
    const middle = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 });
    within(preview).getByText("site").dispatchEvent(middle);
    expect(middle.defaultPrevented).toBe(true);
    expect(onOpenLink).not.toHaveBeenCalled();
  });
});

describe("FileViewer follows the file while its terminal works", () => {
  it("reads the file again when the terminal prints, at most once a second, keeping the same view", async () => {
    vi.useFakeTimers();
    try {
      const listeners = new Set<(text: string) => void>();
      const subscribeOutput = (l: (text: string) => void) => (listeners.add(l), () => void listeners.delete(l));
      let content = "v1";
      const load = vi.fn(async () => ({ path: "/p/a.ts", content, truncated: false }));
      render(<FileViewer path="/p/a.ts" load={load} onClose={() => {}} subscribeOutput={subscribeOutput} prompt={0} />);
      await act(() => vi.advanceTimersByTimeAsync(10));
      const view = editorView();
      expect(view.state.doc.toString()).toBe("v1");
      // The AI tool prints while it edits the file: one read a second, not one per output.
      content = "v2";
      for (let i = 0; i < 5; i++) act(() => listeners.forEach((l) => l("working")));
      await act(() => vi.advanceTimersByTimeAsync(1100));
      expect(load).toHaveBeenCalledTimes(2);
      expect(editorView()).toBe(view);
      expect(view.state.doc.toString()).toBe("v2");
      // Unchanged text changes nothing.
      act(() => listeners.forEach((l) => l("more")));
      await act(() => vi.advanceTimersByTimeAsync(1100));
      expect(load).toHaveBeenCalledTimes(3);
      expect(view.state.doc.toString()).toBe("v2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads it again when the terminal's prompt comes back, and keeps the text when a read fails", async () => {
    let content = "first";
    let fail = false;
    const load = vi.fn(async () => {
      if (fail) throw "cannot read /p/a.ts: gone";
      return { path: "/p/a.ts", content, truncated: false };
    });
    const { rerender } = render(<FileViewer path="/p/a.ts" load={load} onClose={() => {}} prompt={0} />);
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("first"));
    content = "second";
    rerender(<FileViewer path="/p/a.ts" load={load} onClose={() => {}} prompt={1} />);
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("second"));
    fail = true;
    rerender(<FileViewer path="/p/a.ts" load={load} onClose={() => {}} prompt={2} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    expect(document.querySelector(".cm-content")?.textContent).toBe("second");
  });
});

describe("FileViewer editing (S1, S4, S5)", () => {
  const type = (text: string) =>
    act(() => {
      const view = editorView();
      view.dispatch({ changes: { from: view.state.doc.length, insert: text }, userEvent: "input.type" });
    });
  const saveButton = () => screen.getByRole("button", { name: "Save" });

  it("edits the file and saves it with the header button, over the text that was opened", async () => {
    const save = vi.fn(async () => {});
    render(<FileViewer path="/p/notes.txt" load={file("one")} onClose={() => {}} save={save} />);
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("one"));
    expect(editorView().state.readOnly).toBe(false);
    expect(saveButton().hasAttribute("disabled")).toBe(true);
    expect(screen.queryByLabelText("Unsaved changes")).toBeNull();

    type(" two");
    expect(screen.getByLabelText("Unsaved changes")).toBeTruthy();
    expect(saveButton().hasAttribute("disabled")).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledWith("one", "one two"));
    await waitFor(() => expect(screen.queryByLabelText("Unsaved changes")).toBeNull());
    expect(saveButton().hasAttribute("disabled")).toBe(true);

    // The next save is checked against what was saved.
    type("!");
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenLastCalledWith("one two", "one two!"));
  });

  it("saves with Ctrl+S", async () => {
    const save = vi.fn(async () => {});
    render(<FileViewer path="/p/notes.txt" load={file("a")} onClose={() => {}} save={save} />);
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("a"));
    type("b");
    fireEvent.keyDown(editorView().contentDOM, { key: "s", code: "KeyS", ctrlKey: true });
    await waitFor(() => expect(save).toHaveBeenCalledWith("a", "ab"));
  });

  it("keeps the edits and says why when saving fails", async () => {
    const save = vi.fn(async () => {
      throw "cannot save /p/notes.txt: it changed on disk since it was opened";
    });
    render(<FileViewer path="/p/notes.txt" load={file("a")} onClose={() => {}} save={save} />);
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("a"));
    type("b");
    fireEvent.click(saveButton());
    expect((await screen.findByRole("alert")).textContent).toBe(
      "cannot save /p/notes.txt: it changed on disk since it was opened",
    );
    expect(editorView().state.doc.toString()).toBe("ab");
    expect(screen.getByLabelText("Unsaved changes")).toBeTruthy();
  });

  it("does not replace unsaved edits when the file is read again", async () => {
    let content = "first";
    const load = vi.fn(async () => ({ path: "/p/a.ts", content, truncated: false }));
    const save = vi.fn(async () => {});
    const { rerender } = render(<FileViewer path="/p/a.ts" load={load} onClose={() => {}} save={save} prompt={0} />);
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("first"));
    type(" mine");
    content = "changed on disk";
    rerender(<FileViewer path="/p/a.ts" load={load} onClose={() => {}} save={save} prompt={1} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(editorView().state.doc.toString()).toBe("first mine");
  });

  it("saves by itself shortly after typing stops when auto-save is on", async () => {
    const save = vi.fn(async () => {});
    render(<FileViewer path="/p/notes.txt" load={file("a")} onClose={() => {}} save={save} autoSave />);
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("a"));
    type("b");
    type("c");
    expect(save).not.toHaveBeenCalled();
    await waitFor(() => expect(save).toHaveBeenCalledWith("a", "abc"), { timeout: 3000 });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("keeps the file's own line endings (CRLF), and undoing every edit leaves nothing to save", async () => {
    const save = vi.fn(async () => {});
    render(<FileViewer path="/p/win.txt" load={file("a\r\nb\r\n")} onClose={() => {}} save={save} />);
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("ab"));
    act(() => {
      const view = editorView();
      view.dispatch({ changes: { from: 1, insert: "x" }, userEvent: "input.type" });
    });
    expect(screen.getByLabelText("Unsaved changes")).toBeTruthy();
    act(() => {
      const view = editorView();
      view.dispatch({ changes: { from: 1, to: 2 }, userEvent: "delete" });
    });
    expect(screen.queryByLabelText("Unsaved changes")).toBeNull();
    type("c");
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledWith("a\r\nb\r\n", "a\r\nb\r\nc"));
  });

  it("leaves the text and the cursor of a CRLF file alone once it is saved", async () => {
    const save = vi.fn(async () => {});
    render(<FileViewer path="/p/win.txt" load={file("a\r\nb")} onClose={() => {}} save={save} />);
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("ab"));
    act(() => {
      editorView().dispatch({ changes: { from: 1, insert: "x" }, selection: { anchor: 2 }, userEvent: "input.type" });
    });
    const dispatch = vi.spyOn(editorView(), "dispatch");
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledWith("a\r\nb", "ax\r\nb"));
    await waitFor(() => expect(screen.queryByLabelText("Unsaved changes")).toBeNull());
    expect(dispatch).not.toHaveBeenCalled();
    expect(editorView().state.selection.main.head).toBe(2);
  });

  it("keeps a lone LF in a CRLF file and a lone CR in an LF file", async () => {
    const save = vi.fn(async () => {});
    const { unmount } = render(<FileViewer path="/p/mixed.txt" load={file("a\r\nb\nc")} onClose={() => {}} save={save} />);
    await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy());
    type("!");
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledWith("a\r\nb\nc", "a\r\nb\nc!"));
    unmount();
    render(<FileViewer path="/p/cr.txt" load={file("a\rb\n")} onClose={() => {}} save={save} />);
    await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy());
    type("!");
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenLastCalledWith("a\rb\n", "a\rb\n!"));
  });

  it("keeps a file shown only in part read-only, and has no save button without a way to save", async () => {
    const { unmount } = render(
      <FileViewer path="/p/big.log" load={file("start", true)} onClose={() => {}} save={vi.fn()} />,
    );
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("start"));
    expect(editorView().state.readOnly).toBe(true);
    expect(saveButton().hasAttribute("disabled")).toBe(true);
    unmount();
    render(<FileViewer path="/p/notes.txt" load={file("x")} onClose={() => {}} />);
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("x"));
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
