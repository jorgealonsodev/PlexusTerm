// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { imageType, isMarkdown, renderMarkdown } from "./markdown";

const html = (text: string) => {
  const host = document.createElement("div");
  host.innerHTML = renderMarkdown(text);
  return host;
};

describe("Markdown preview (S4)", () => {
  it("renders GitHub-flavoured Markdown", () => {
    const host = html("# Title\n\n- one\n- **two**\n\n```ts\nconst a = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[site](https://example.com)");
    expect(host.querySelector("h1")?.textContent).toBe("Title");
    expect([...host.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["one", "two"]);
    expect(host.querySelector("strong")?.textContent).toBe("two");
    expect(host.querySelector("pre code")?.textContent).toBe("const a = 1;\n");
    expect(host.querySelector("table td")?.textContent).toBe("1");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
  });

  it("removes scripts, event handlers, javascript: links, frames, forms and styles", () => {
    const host = html(
      [
        "<script>window.hacked = 1</script>",
        '<img src="x" onerror="window.hacked = 1">',
        '<a href="javascript:alert(1)">click</a>',
        "[md link](javascript:alert(1))",
        '<iframe src="https://example.com"></iframe>',
        '<form action="https://example.com"><input name="password"><button>go</button></form>',
        "<style>body { display: none }</style>",
        '<p style="position: fixed">styled</p>',
        '<svg><script>window.hacked = 1</script></svg>',
      ].join("\n\n"),
    );
    const out = host.innerHTML;
    expect(host.querySelector("script, iframe, form, input, button, style")).toBeNull();
    expect(out).not.toMatch(/onerror|javascript:|position: fixed/i);
    expect(host.querySelector("p[style]")).toBeNull();
    expect(host.textContent).toContain("styled");
  });

  it("tells Markdown files by their name", () => {
    for (const name of ["README.md", "notes.MARKDOWN", "a.mdx", "doc.mkd"]) expect(isMarkdown(name)).toBe(true);
    for (const name of ["md", "a.mdown.txt", "main.ts", "Makefile"]) expect(isMarkdown(name)).toBe(false);
  });

  it("keeps the file's element ids from clobbering the window's globals", () => {
    const host = html('<a id="__TAURI_INTERNALS__" name="cookie">x</a>');
    expect(host.querySelector("#__TAURI_INTERNALS__")).toBeNull();
    expect(host.querySelector("a")?.textContent).toBe("x");
  });

  it("points a Markdown file's own images at its folder, keeps web and inline ones, and drops the rest", () => {
    const host = document.createElement("div");
    host.innerHTML = renderMarkdown(
      [
        "![a](docs/shot%201.png)",
        "![b](../img/logo.svg?raw=1#top)",
        "![c](/srv/pics/c.gif)",
        "![d](https://example.com/badge.svg)",
        "![e](http://example.com/plain.png)",
        "![f](data:image/png;base64,iVBORw0KGgo=)",
        "![g](file:///etc/passwd.png)",
        "![h](./here.jpg)",
      ].join("\n\n"),
      "/home/me/repo/README.md",
    );
    const imgs = [...host.querySelectorAll("img")];
    const shown = imgs.map((img) => [img.getAttribute("src"), img.getAttribute("data-file-src")]);
    expect(shown).toEqual([
      [null, "/home/me/repo/docs/shot 1.png"],
      [null, "/home/me/img/logo.svg"],
      [null, "/srv/pics/c.gif"],
      ["https://example.com/badge.svg", null],
      [null, null],
      ["data:image/png;base64,iVBORw0KGgo=", null],
      [null, null],
      [null, "/home/me/repo/here.jpg"],
    ]);
    // Web images do not tell the site which page asked for them.
    expect(imgs[3].getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("joins images to a Windows folder with its own separator", () => {
    const host = document.createElement("div");
    host.innerHTML = renderMarkdown("![a](img/a.png)", "C:\\work\\app\\README.md");
    expect(host.querySelector("img")?.getAttribute("data-file-src")).toBe("C:\\work\\app\\img\\a.png");
  });

  it("names each image type for the browser", () => {
    expect(imageType("/a/logo.SVG")).toBe("image/svg+xml");
    expect(imageType("shot.jpg")).toBe("image/jpeg");
    expect(imageType("x.webp")).toBe("image/webp");
    expect(imageType("notes.txt")).toBe("application/octet-stream");
  });

  it("never trusts an image path the file writes itself", () => {
    const host = document.createElement("div");
    host.innerHTML = renderMarkdown(
      '<img data-file-src="\\\\attacker.example\\s\\x.png" alt="a">\n\n<img src="https://example.com/b.png" data-file-src="/etc/x.png" alt="b">',
      "/home/me/repo/README.md",
    );
    const [a, b] = [...host.querySelectorAll("img")];
    expect(a.getAttribute("data-file-src")).toBeNull();
    expect(b.getAttribute("data-file-src")).toBeNull();
    expect(b.getAttribute("src")).toBe("https://example.com/b.png");
  });

  it("shows the image of a <picture> source that matches, as GitHub does for light and dark logos", () => {
    const picture = [
      '<p align="center"><picture>',
      '<source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">',
      '<img src="docs/logo-light.svg" alt="logo" width="520" srcset="docs/logo@2x.svg 2x">',
      "</picture></p>",
    ].join("\n");
    const render = (dark: boolean) => {
      window.matchMedia = ((query: string) => ({ matches: dark && query.includes("dark") })) as typeof window.matchMedia;
      const host = document.createElement("div");
      host.innerHTML = renderMarkdown(picture, "/home/me/repo/README.md");
      return host;
    };
    const dark = render(true);
    expect(dark.querySelector("img")?.getAttribute("data-file-src")).toBe("/home/me/repo/docs/logo-dark.svg");
    // No address is left for the browser to resolve against the app itself.
    expect(dark.querySelector("source, [srcset]")).toBeNull();
    expect(render(false).querySelector("img")?.getAttribute("data-file-src")).toBe("/home/me/repo/docs/logo-light.svg");
  });

  it("keeps web sources of a <picture>, and drops srcset anywhere else", () => {
    window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
    const host = document.createElement("div");
    host.innerHTML = renderMarkdown(
      '<picture><source srcset="https://example.com/a.png 1x, https://example.com/a2.png 2x"><img src="b.png" alt="a"></picture>\n\n<img src="https://example.com/c.png" srcset="https://evil.example/c.png 2x" alt="c">',
      "/r/README.md",
    );
    const [a, c] = [...host.querySelectorAll("img")];
    expect(a.getAttribute("src")).toBe("https://example.com/a.png");
    expect(a.getAttribute("data-file-src")).toBeNull();
    expect(c.getAttribute("srcset")).toBeNull();
    expect(host.querySelector("source")).toBeNull();
  });

  it("drops the sources of a <picture> with no image of its own", () => {
    const host = document.createElement("div");
    host.innerHTML = renderMarkdown('<picture><source srcset="docs/a.png"></picture>', "/r/README.md");
    expect(host.querySelector("source, [srcset]")).toBeNull();
  });
});
