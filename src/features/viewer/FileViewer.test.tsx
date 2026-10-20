// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { language } from "@codemirror/language";
import { FileViewer } from "./FileViewer";
import { markedChanges } from "./codeView";

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

describe("FileViewer shows a Markdown file's images", () => {
  it("reads the file's own images next to it, keeps web ones, and lets the blob addresses go when closed", async () => {
    const made: Blob[] = [];
    const revoked: string[] = [];
    vi.stubGlobal("URL", Object.assign(URL, {
      createObjectURL: (blob: Blob) => {
        made.push(blob);
        return `blob:test/${made.length}`;
      },
      revokeObjectURL: (url: string) => revoked.push(url),
    }));
    const loadImage = vi.fn(async (path: string) => new Blob([path], { type: "image/png" }));
    const { unmount } = render(
      <FileViewer
        path="/p/README.md"
        load={file("![shot](img/shot.png)\n\n![badge](https://example.com/b.svg)\n\n![missing](gone.png)")}
        loadImage={(path) => (path.endsWith("gone.png") ? Promise.reject(new Error("no such file")) : loadImage(path))}
        onClose={() => {}}
      />,
    );
    const preview = await screen.findByRole("article");
    const shot = within(preview).getByAltText("shot");
    await waitFor(() => expect(shot.getAttribute("src")).toBe("blob:test/1"));
    expect(loadImage).toHaveBeenCalledWith("/p/img/shot.png");
    expect(within(preview).getByAltText("badge").getAttribute("src")).toBe("https://example.com/b.svg");
    // An image that cannot be read keeps its alternative text.
    expect(within(preview).getByAltText("missing").getAttribute("src")).toBeNull();
    unmount();
    expect(revoked).toEqual(["blob:test/1"]);
    vi.unstubAllGlobals();
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

  it("never reads the file again for the echo of what is typed", async () => {
    vi.useFakeTimers();
    try {
      const listeners = new Set<(text: string, echo?: boolean) => void>();
      const subscribeOutput = (l: (text: string, echo?: boolean) => void) => (listeners.add(l), () => void listeners.delete(l));
      const load = vi.fn(async () => ({ path: "/p/a.ts", content: "v1", truncated: false }));
      render(<FileViewer path="/p/a.ts" load={load} onClose={() => {}} subscribeOutput={subscribeOutput} prompt={0} />);
      await act(() => vi.advanceTimersByTimeAsync(10));
      for (let i = 0; i < 10; i++) act(() => listeners.forEach((l) => l("k", true)));
      await act(() => vi.advanceTimersByTimeAsync(1100));
      expect(load).toHaveBeenCalledTimes(1);
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
    await waitFor(() => expect(save).toHaveBeenCalledWith("one", "one two", "utf-8", "utf-8"));
    await waitFor(() => expect(screen.queryByLabelText("Unsaved changes")).toBeNull());
    expect(saveButton().hasAttribute("disabled")).toBe(true);

    // The next save is checked against what was saved.
    type("!");
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenLastCalledWith("one two", "one two!", "utf-8", "utf-8"));
  });

  it("saves with Ctrl+S", async () => {
    const save = vi.fn(async () => {});
    render(<FileViewer path="/p/notes.txt" load={file("a")} onClose={() => {}} save={save} />);
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("a"));
    type("b");
    fireEvent.keyDown(editorView().contentDOM, { key: "s", code: "KeyS", ctrlKey: true });
    await waitFor(() => expect(save).toHaveBeenCalledWith("a", "ab", "utf-8", "utf-8"));
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
    await waitFor(() => expect(save).toHaveBeenCalledWith("a", "abc", "utf-8", "utf-8"), { timeout: 3000 });
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
    await waitFor(() => expect(save).toHaveBeenCalledWith("a\r\nb\r\n", "a\r\nb\r\nc", "utf-8", "utf-8"));
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
    await waitFor(() => expect(save).toHaveBeenCalledWith("a\r\nb", "ax\r\nb", "utf-8", "utf-8"));
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
    await waitFor(() => expect(save).toHaveBeenCalledWith("a\r\nb\nc", "a\r\nb\nc!", "utf-8", "utf-8"));
    unmount();
    render(<FileViewer path="/p/cr.txt" load={file("a\rb\n")} onClose={() => {}} save={save} />);
    await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy());
    type("!");
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenLastCalledWith("a\rb\n", "a\rb\n!", "utf-8", "utf-8"));
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

describe("FileViewer changed lines against the last commit", () => {
  const committed = async () => "one\ntwo\nthree\nfour";
  const marks = () => markedChanges(editorView().state);

  it("marks added, modified and deleted lines in the gutter, as VS Code does", async () => {
    render(
      <FileViewer
        path="/p/notes.txt"
        load={file("one\nTWO\nthree\nnew")}
        loadCommitted={committed}
        showChanges
        onShowChangesChange={() => {}}
        onClose={() => {}}
      />,
    );
    await waitFor(() =>
      expect(marks()).toEqual([
        { line: 2, kind: "modified" },
        { line: 4, kind: "modified" },
      ]),
    );
    expect(document.querySelectorAll(".cm-changes .cm-change--modified")).toHaveLength(2);
  });

  it("turns the marks on and off with its button next to Save", async () => {
    const onShowChangesChange = vi.fn();
    const loadCommitted = vi.fn(committed);
    const { rerender } = render(
      <FileViewer
        path="/p/notes.txt"
        load={file("one\ntwo\nthree")}
        loadCommitted={loadCommitted}
        showChanges={false}
        onShowChangesChange={onShowChangesChange}
        save={async () => {}}
        onClose={() => {}}
      />,
    );
    const button = await screen.findByRole("button", { name: "Show changed lines" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    // Next to Save, in the header.
    expect(button.nextElementSibling).toBe(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("onetwothree"));
    expect(marks()).toEqual([]);
    expect(loadCommitted).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(onShowChangesChange).toHaveBeenCalledWith(true);
    rerender(
      <FileViewer
        path="/p/notes.txt"
        load={file("one\ntwo\nthree")}
        loadCommitted={loadCommitted}
        showChanges
        onShowChangesChange={onShowChangesChange}
        save={async () => {}}
        onClose={() => {}}
      />,
    );
    await waitFor(() => expect(marks()).toEqual([{ line: 3, kind: "deletedBelow" }]));
    expect(screen.getByRole("button", { name: "Show changed lines" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("marks nothing for a file outside git, and has no button without a commit to compare with", async () => {
    const { unmount } = render(
      <FileViewer path="/p/notes.txt" load={file("a")} loadCommitted={async () => null} showChanges onShowChangesChange={() => {}} onClose={() => {}} />,
    );
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("a"));
    await new Promise((r) => setTimeout(r, 20));
    expect(marks()).toEqual([]);
    unmount();
    render(<FileViewer path="/p/notes.txt" load={file("a")} onClose={() => {}} />);
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("a"));
    expect(screen.queryByRole("button", { name: "Show changed lines" })).toBeNull();
  });

  it("marks the lines again as the text is edited", async () => {
    render(
      <FileViewer
        path="/p/notes.txt"
        load={file("one\ntwo\nthree\nfour")}
        loadCommitted={committed}
        showChanges
        onShowChangesChange={() => {}}
        save={async () => {}}
        onClose={() => {}}
      />,
    );
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("onetwothreefour"));
    await new Promise((r) => setTimeout(r, 20));
    expect(marks()).toEqual([]);
    const view = editorView();
    act(() => view.dispatch({ changes: { from: 0, insert: "zero\n" } }));
    expect(marks()).toEqual([{ line: 1, kind: "added" }]);
  });
});

describe("FileViewer status bar: encoding, line endings and language", () => {
  const bar = () => within(screen.getByRole("toolbar", { name: "File status" }));
  const pick = (button: string, option: string) => {
    fireEvent.click(bar().getByRole("button", { name: button }));
    fireEvent.click(screen.getByRole("option", { name: option }));
  };
  const shown = () => document.querySelector(".cm-content")?.textContent;

  it("shows the file's encoding, line endings and language", async () => {
    const { unmount } = render(<FileViewer path="/p/main.ts" load={file("const a = 1;\n")} onClose={() => {}} />);
    await waitFor(() => expect(shown()).toBe("const a = 1;"));
    expect(bar().getByRole("button", { name: "UTF-8" })).toBeTruthy();
    expect(bar().getByRole("button", { name: "LF" })).toBeTruthy();
    expect(bar().getByRole("button", { name: "TypeScript" })).toBeTruthy();
    unmount();
    const bom = async () => ({ path: "/p/x", content: "a\r\nb", truncated: false, encoding: "utf-8-bom" });
    render(<FileViewer path="/p/data.unknownext" load={bom} onClose={() => {}} />);
    await waitFor(() => expect(shown()).toBe("ab"));
    expect(bar().getByRole("button", { name: "UTF-8 with BOM" })).toBeTruthy();
    expect(bar().getByRole("button", { name: "CRLF" })).toBeTruthy();
    expect(bar().getByRole("button", { name: "Plain Text" })).toBeTruthy();
  });

  it("highlights the text with the language chosen in the list, which a filter narrows", async () => {
    render(<FileViewer path="/p/notes.txt" load={file("x = 1")} onClose={() => {}} />);
    await waitFor(() => expect(shown()).toBe("x = 1"));
    fireEvent.click(bar().getByRole("button", { name: "Plain Text" }));
    const list = screen.getByRole("listbox", { name: "Select language" });
    expect(within(list).getByRole("option", { name: "Plain Text" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.change(screen.getByRole("textbox", { name: "Filter" }), { target: { value: "pyth" } });
    expect(within(list).queryByRole("option", { name: "TypeScript" })).toBeNull();
    fireEvent.click(within(list).getByRole("option", { name: "Python" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    await waitFor(() => expect(editorView().state.facet(language)?.name).toBe("python"));
    expect(bar().getByRole("button", { name: "Python" })).toBeTruthy();
    pick("Python", "Plain Text");
    await waitFor(() => expect(editorView().state.facet(language)).toBeNull());
  });

  it("converts the line endings, which is an edit to save", async () => {
    const save = vi.fn(async () => {});
    render(<FileViewer path="/p/notes.txt" load={file("a\nb\n")} onClose={() => {}} save={save} />);
    await waitFor(() => expect(shown()).toBe("ab"));
    pick("LF", "CRLF");
    expect(screen.getByLabelText("Unsaved changes")).toBeTruthy();
    expect(bar().getByRole("button", { name: "CRLF" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("a\nb\n", "a\r\nb\r\n", "utf-8", "utf-8"));
    pick("CRLF", "LF");
    expect(screen.getByLabelText("Unsaved changes")).toBeTruthy();
  });

  it("offers no line ending change for a file shown only in part", async () => {
    render(<FileViewer path="/p/big.log" load={file("a\nb", true)} onClose={() => {}} save={vi.fn(async () => {})} />);
    await waitFor(() => expect(shown()).toBe("ab"));
    expect((bar().getByRole("button", { name: "LF" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers no line ending change while a Markdown file shows rendered", async () => {
    render(<FileViewer path="/p/README.md" load={file("# a\n\nb\n")} onClose={() => {}} save={vi.fn(async () => {})} />);
    await screen.findByRole("heading", { name: "a" });
    expect((bar().getByRole("button", { name: "LF" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Code" }));
    await waitFor(() => expect(shown()).toBe("# ab"));
    expect((bar().getByRole("button", { name: "LF" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("reopens the file with another encoding", async () => {
    const load = vi.fn(async (encoding?: string) => ({
      path: "/p/x",
      content: encoding === "windows-1252" ? "café" : "caf?",
      truncated: false,
      encoding: encoding ?? "utf-8",
    }));
    render(<FileViewer path="/p/old.txt" load={load} onClose={() => {}} />);
    await waitFor(() => expect(shown()).toBe("caf?"));
    expect(load).toHaveBeenCalledWith(undefined);
    pick("UTF-8", "Reopen with encoding");
    fireEvent.click(screen.getByRole("option", { name: "Windows 1252 — Western" }));
    await waitFor(() => expect(shown()).toBe("café"));
    expect(load).toHaveBeenLastCalledWith("windows-1252");
    expect(bar().getByRole("button", { name: "Windows 1252" })).toBeTruthy();
  });

  it("saves the file with another encoding, and keeps it for the next saves", async () => {
    const save = vi.fn(async () => {});
    render(<FileViewer path="/p/notes.txt" load={file("one")} onClose={() => {}} save={save} />);
    await waitFor(() => expect(shown()).toBe("one"));
    pick("UTF-8", "Save with encoding");
    fireEvent.click(screen.getByRole("option", { name: "UTF-16 LE — Unicode" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("one", "one", "utf-16le", "utf-8"));
    expect(bar().getByRole("button", { name: "UTF-16 LE" })).toBeTruthy();
    act(() => {
      const view = editorView();
      view.dispatch({ changes: { from: 3, insert: "!" }, userEvent: "input.type" });
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith("one", "one!", "utf-16le", "utf-16le"));
  });

  it("keeps a clean file clean when it is read again with other line endings", async () => {
    let content = "a\nb\n";
    const save = vi.fn(async () => {});
    const load = async () => ({ path: "/p/x", content, truncated: false });
    const { rerender } = render(<FileViewer path="/p/notes.txt" load={load} onClose={() => {}} save={save} autoSave prompt={0} />);
    await waitFor(() => expect(shown()).toBe("ab"));
    content = "a\r\nb\r\n";
    rerender(<FileViewer path="/p/notes.txt" load={load} onClose={() => {}} save={save} autoSave prompt={1} />);
    await waitFor(() => expect(bar().getByRole("button", { name: "CRLF" })).toBeTruthy());
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.queryByLabelText("Unsaved changes")).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps the shown text when reopening with an encoding fails, and reads it as before afterwards", async () => {
    const load = vi.fn(async (encoding?: string) => {
      if (encoding === "shift_jis") throw "cannot view /p/x: it is not a text file in shift_jis";
      return { path: "/p/x", content: "hello", truncated: false, encoding: "utf-8" };
    });
    const { rerender } = render(<FileViewer path="/p/notes.txt" load={load} onClose={() => {}} prompt={0} />);
    await waitFor(() => expect(shown()).toBe("hello"));
    pick("UTF-8", "Reopen with encoding");
    fireEvent.click(screen.getByRole("option", { name: "Shift JIS — Japanese" }));
    expect((await screen.findByRole("alert")).textContent).toBe("cannot view /p/x: it is not a text file in shift_jis");
    expect(shown()).toBe("hello");
    expect(bar().getByRole("button", { name: "UTF-8" })).toBeTruthy();
    rerender(<FileViewer path="/p/notes.txt" load={load} onClose={() => {}} prompt={1} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    expect(load).toHaveBeenLastCalledWith(undefined);
  });

  it("highlights the last language chosen, even when an earlier one loads later", async () => {
    render(<FileViewer path="/p/notes.txt" load={file("x = 1")} onClose={() => {}} />);
    await waitFor(() => expect(shown()).toBe("x = 1"));
    pick("Plain Text", "Python");
    pick("Python", "Plain Text");
    await new Promise((r) => setTimeout(r, 100));
    expect(editorView().state.facet(language)).toBeNull();
  });

  it("saves with the encoding chosen while another save runs, even after more typing", async () => {
    let finish: () => void = () => {};
    const save = vi.fn((_e: string, _c: string, _enc: string, _from: string) => new Promise<void>((r) => (finish = r)));
    render(<FileViewer path="/p/notes.txt" load={file("one")} onClose={() => {}} save={save} />);
    await waitFor(() => expect(shown()).toBe("one"));
    const add = (text: string) =>
      act(() => {
        const view = editorView();
        view.dispatch({ changes: { from: view.state.doc.length, insert: text }, userEvent: "input.type" });
      });
    add("!");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    pick("UTF-8", "Save with encoding");
    fireEvent.click(screen.getByRole("option", { name: "UTF-16 LE — Unicode" }));
    add("?");
    await act(async () => finish());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1].slice(1, 3)).toEqual(["one!?", "utf-16le"]);
  });

  it("closes a list with Escape", async () => {
    render(<FileViewer path="/p/notes.txt" load={file("x")} onClose={() => {}} />);
    await waitFor(() => expect(shown()).toBe("x"));
    fireEvent.click(bar().getByRole("button", { name: "Plain Text" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Filter" }), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
