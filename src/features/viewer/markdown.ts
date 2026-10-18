import DOMPurify from "dompurify";
import { marked } from "marked";

/** Markdown files, by name. */
export const isMarkdown = (name: string) => /\.(md|markdown|mdx|mkd|mdwn)$/i.test(name);

/**
 * A Markdown file as sanitized HTML (S4). The file is not trusted: scripts, event handlers,
 * `javascript:` links, frames, forms, styles and inline styles are removed, on top of the
 * window's CSP, which runs no script that is not the app's.
 */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false, gfm: true });
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "form", "input", "button", "select", "textarea", "iframe", "frame", "object", "embed", "base", "meta", "link"],
    FORBID_ATTR: ["style"],
    // Ids and names get a `user-content-` prefix, so none can stand for a global of the window.
    SANITIZE_NAMED_PROPS: true,
  });
}
