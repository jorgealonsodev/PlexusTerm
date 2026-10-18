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
