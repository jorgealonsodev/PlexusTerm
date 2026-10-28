import { useMemo, type MouseEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { renderMarkdown } from "../viewer/markdown";

/**
 * A release's notes from GitHub (Markdown), sanitized like any Markdown file the viewer shows;
 * a link opens in the system browser, never in the app window.
 */
export function ReleaseNotes({ notes }: { notes: string }) {
  const html = useMemo(() => renderMarkdown(notes), [notes]);
  const onClick = (e: MouseEvent<HTMLElement>) => {
    const link = (e.target as Element).closest("a");
    if (!link) return;
    e.preventDefault();
    const href = link.getAttribute("href") ?? "";
    if (/^https?:\/\//i.test(href)) void openUrl(href).catch(() => {});
  };
  // A middle click would open the link in a new window of the app's own.
  const onAuxClick = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as Element).closest("a")) e.preventDefault();
  };
  return (
    <article
      className="release-notes viewer__markdown"
      onClick={onClick}
      onAuxClick={onAuxClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
