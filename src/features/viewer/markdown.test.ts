// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isMarkdown, renderMarkdown } from "./markdown";

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
});
