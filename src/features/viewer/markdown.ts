import DOMPurify from "dompurify";
import { marked } from "marked";

/** Markdown files, by name. */
export const isMarkdown = (name: string) => /\.(md|markdown|mdx|mkd|mdwn)$/i.test(name);

/**
 * A Markdown file as sanitized HTML (S4). The file is not trusted: scripts, event handlers,
 * `javascript:` links, frames, forms, styles and inline styles are removed, on top of the
 * window's CSP, which runs no script that is not the app's.
 *
 * Images: web ones (`https:`) and inline ones (`data:image/…`) keep their address; the file's own
 * (a path, relative to its folder `filePath` is in) move to `data-file-src`, for the viewer to read
 * them; any other is dropped.
 */
export function renderMarkdown(text: string, filePath = ""): string {
  const html = marked.parse(text, { async: false, gfm: true });
  const clean = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "form", "input", "button", "select", "textarea", "iframe", "frame", "object", "embed", "base", "meta", "link"],
    FORBID_ATTR: ["style"],
    // Ids and names get a `user-content-` prefix, so none can stand for a global of the window.
    SANITIZE_NAMED_PROPS: true,
  });
  if (!clean.includes("<img")) return clean;
  const page = document.createElement("template");
  page.innerHTML = clean;
  for (const img of page.content.querySelectorAll("img")) {
    const src = img.getAttribute("src") ?? "";
    img.removeAttribute("src");
    // Only paths worked out here are read: the file may write the attribute itself.
    img.removeAttribute("data-file-src");
    if (/^https:\/\//i.test(src) || /^data:image\//i.test(src)) {
      img.setAttribute("src", src);
      img.setAttribute("referrerpolicy", "no-referrer");
    } else {
      const path = filePath && fileImagePath(src, filePath);
      if (path) img.setAttribute("data-file-src", path);
    }
  }
  return page.innerHTML;
}

/** The file an image link of the Markdown file `filePath` names, or null when it names none. */
function fileImagePath(src: string, filePath: string): string | null {
  // An address with a scheme (`http:`, `file:`, `mailto:`) is not a path; a drive letter is.
  if (!src || (/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^[a-z]:[\\/]/i.test(src))) return null;
  let path: string;
  try {
    path = decodeURIComponent(src.replace(/[?#].*$/, ""));
  } catch {
    return null;
  }
  if (!path) return null;
  const windows = /^[a-z]:\\/i.test(filePath) || filePath.startsWith("\\\\");
  const sep = windows ? "\\" : "/";
  const absolute = path.startsWith("/") || /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\");
  const folder = filePath.slice(0, Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")));
  const parts = (absolute ? path : `${folder}/${path}`).split(/[\\/]/);
  const out: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    // Never above the root (the drive, or the leading empty part of `/…`).
    if (part === "..") {
      if (out.length > 1) out.pop();
      continue;
    }
    if (part === "" && out.length > 0) continue;
    out.push(part);
  }
  return out.join(sep) || null;
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

/** The media type of an image file, by its extension (an SVG shows only with its own). */
export const imageType = (path: string) => IMAGE_TYPES[/\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase() ?? ""] ?? "application/octet-stream";
