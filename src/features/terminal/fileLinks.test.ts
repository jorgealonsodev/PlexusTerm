// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createFileLinkProvider, createLinkHandler, fileUriPath, findPathCandidates, resolvePath, webLinkHandler, type FileLinks, type LineCells } from "./fileLinks";

const texts = (line: string) => findPathCandidates(line).map((c) => c.text);

describe("findPathCandidates", () => {
  it("finds relative, absolute and home paths with a folder in them", () => {
    expect(texts("Wrote plexusterm-host/docs/PRD.md")).toEqual(["plexusterm-host/docs/PRD.md"]);
    expect(texts("see /etc/ssh/sshd_config and ~/notes/todo.txt")).toEqual(["/etc/ssh/sshd_config", "~/notes/todo.txt"]);
    expect(texts("● Update(./src/App.tsx)")).toEqual(["./src/App.tsx"]);
    expect(texts("../shared/lib.rs")).toEqual(["../shared/lib.rs"]);
  });

  it("drops a line and column suffix and trailing punctuation", () => {
    expect(findPathCandidates("at src/main.ts:42:7, then")).toEqual([{ start: 3, end: 14, text: "src/main.ts" }]);
    expect(texts("(src/a.ts).")).toEqual(["src/a.ts"]);
  });

  it("finds Windows paths", () => {
    expect(texts("open C:\\Users\\me\\a.txt now")).toEqual(["C:\\Users\\me\\a.txt"]);
  });

  it("finds bare file names with an extension, but nothing inside URLs, plain words or lone slashes", () => {
    expect(texts("Read README.md and a / b and and/or")).toEqual(["README.md", "and/or"]);
    expect(texts("https://example.com/a/b.html and http://x.io")).toEqual([]);
    expect(texts("see notes.txt.")).toEqual(["notes.txt"]);
  });
});

describe("resolvePath", () => {
  it("joins relative paths to the folder, expands the home folder and keeps absolute ones", () => {
    expect(resolvePath("docs/PRD.md", "/work/app", "/home/me")).toBe("/work/app/docs/PRD.md");
    expect(resolvePath("./src/../README.md", "/work/app", "/home/me")).toBe("/work/app/README.md");
    expect(resolvePath("../host/PRD.md", "/work/app", "/home/me")).toBe("/work/host/PRD.md");
    expect(resolvePath("~/notes/a.txt", "/work", "/home/me")).toBe("/home/me/notes/a.txt");
    expect(resolvePath("/etc/hosts", "/work", "/home/me")).toBe("/etc/hosts");
    expect(resolvePath("src\\a.ts", "C:\\work", null)).toBe("C:\\work\\src\\a.ts");
  });

  it("cannot resolve a relative path without a folder", () => {
    expect(resolvePath("docs/a.md", null, "/home/me")).toBeNull();
    expect(resolvePath("~/a.md", "/work", null)).toBeNull();
  });
});

/** One terminal line of single-width characters, then `wide` double-width ones. */
const line = (text: string): LineCells => ({
  cells: [...text].map((chars) => ({ chars, width: chars === "界" ? 2 : 1 })),
});

const provide = (provider: ReturnType<typeof createFileLinkProvider>, y = 1) =>
  new Promise<Parameters<Parameters<typeof provider.provideLinks>[1]>[0]>((done) => provider.provideLinks(y, done));

describe("createFileLinkProvider", () => {
  const links = (existing: string[]): FileLinks & { opened: string[] } => {
    const opened: string[] = [];
    return {
      opened,
      resolve: vi.fn(async (text: string) => (existing.includes(text) ? `/work/${text}` : null)),
      open: (path) => void opened.push(path),
    };
  };

  it("links only the paths that exist, over the cells they cover", async () => {
    const fileLinks = links(["docs/PRD.md"]);
    const provider = createFileLinkProvider(() => line("界 docs/PRD.md and src/gone.ts"), fileLinks);
    const found = await provide(provider);
    expect(found).toHaveLength(1);
    // The wide character takes two cells: the path starts at the fourth one.
    expect(found![0].range).toEqual({ start: { x: 4, y: 1 }, end: { x: 14, y: 1 } });
    expect(found![0].text).toBe("docs/PRD.md");
  });

  it("opens the file on Ctrl+click or Cmd+click only", async () => {
    const fileLinks = links(["docs/PRD.md"]);
    const [link] = (await provide(createFileLinkProvider(() => line("docs/PRD.md"), fileLinks)))!;
    link.activate(new MouseEvent("click"), link.text);
    expect(fileLinks.opened).toEqual([]);
    link.activate(new MouseEvent("click", { ctrlKey: true }), link.text);
    link.activate(new MouseEvent("click", { metaKey: true }), link.text);
    expect(fileLinks.opened).toEqual(["/work/docs/PRD.md", "/work/docs/PRD.md"]);
  });

  it("gives no links for a line without paths, without asking", async () => {
    const fileLinks = links([]);
    expect(await provide(createFileLinkProvider(() => line("plain text"), fileLinks))).toBeUndefined();
    expect(await provide(createFileLinkProvider(() => null, fileLinks))).toBeUndefined();
    expect(fileLinks.resolve).not.toHaveBeenCalled();
  });
});

describe("fileUriPath", () => {
  it("reads the path of a file URI, decoded, and nothing else", () => {
    expect(fileUriPath("file:///home/me/my%20notes.md")).toBe("/home/me/my notes.md");
    expect(fileUriPath("file://box/home/me/a.md")).toBe("/home/me/a.md");
    expect(fileUriPath("file:///C:/Users/me/a.md")).toBe("C:/Users/me/a.md");
    expect(fileUriPath("https://example.com/a.md")).toBeNull();
  });
});

const click = (mods: { ctrlKey?: boolean; metaKey?: boolean } = {}) => new MouseEvent("click", mods);

describe("webLinkHandler", () => {
  it("opens a URL on Ctrl+click or Cmd+click only", () => {
    const openUrl = vi.fn();
    const handle = webLinkHandler(openUrl);
    handle(click(), "https://example.com");
    expect(openUrl).not.toHaveBeenCalled();
    handle(click({ ctrlKey: true }), "https://example.com");
    handle(click({ metaKey: true }), "https://example.com/b");
    expect(openUrl.mock.calls).toEqual([["https://example.com"], ["https://example.com/b"]]);
  });
});

describe("createLinkHandler (hyperlinks a program prints, OSC 8)", () => {
  it("opens web links in the browser and file links as files, on Ctrl+click only", () => {
    const openUrl = vi.fn();
    const openFile = vi.fn();
    const handler = createLinkHandler({ openUrl, openFile: () => openFile });
    const range = { start: { x: 1, y: 1 }, end: { x: 2, y: 1 } };
    handler.activate(click(), "https://example.com", range);
    handler.activate(click({ ctrlKey: true }), "https://example.com", range);
    handler.activate(click({ ctrlKey: true }), "file:///home/me/a.md", range);
    handler.activate(click({ ctrlKey: true }), "javascript:alert(1)", range);
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenCalledWith("https://example.com");
    expect(openFile).toHaveBeenCalledWith("/home/me/a.md");
    expect(handler.allowNonHttpProtocols).toBe(true);
  });

  it("leaves file links alone in a pane that cannot open files", () => {
    const openUrl = vi.fn();
    const handler = createLinkHandler({ openUrl, openFile: () => undefined });
    handler.activate(click({ ctrlKey: true }), "file:///home/me/a.md", { start: { x: 1, y: 1 }, end: { x: 2, y: 1 } });
    expect(openUrl).not.toHaveBeenCalled();
  });
});
