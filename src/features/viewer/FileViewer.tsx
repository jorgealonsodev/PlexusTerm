import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { X } from "lucide-react";
import { useT } from "../../i18n/i18n";
import { describeAttachError, fileName } from "../ai/attachments";
import { createCodeView, reloadText } from "./codeView";
import type { EditorView } from "@codemirror/view";
import { isMarkdown, renderMarkdown } from "./markdown";

/** A file's text as the backend reads it for the viewer. */
export interface ViewedText {
  path: string;
  content: string;
  /** Only the first 4 MiB were read. */
  truncated: boolean;
}

interface FileViewerProps {
  path: string;
  /** Reads the file; called again when `path` changes. */
  load: () => Promise<ViewedText>;
  onClose: () => void;
  /** Opens a web link of a Markdown preview; the system browser by default. */
  onOpenLink?: (url: string) => void;
  /**
   * Listens to the output of the viewer's terminal: while it prints (an AI tool editing files) the
   * file is read again, at most once every REFRESH_MS. Returns the function that stops listening.
   */
  subscribeOutput?: (listener: (text: string) => void) => () => void;
  /** Changes each time the terminal's prompt comes back: the file is read again. */
  prompt?: number;
}

/** The file is read again at most this often while its terminal prints. */
export const REFRESH_MS = 1000;

type Loaded = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; file: ViewedText };

/** The text of a file in a CodeMirror view; a new text replaces the old one in the same view. */
function CodeView({ text, name }: { text: string; name: string }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  useEffect(() => {
    view.current = createCodeView(host.current!, textRef.current, name);
    return () => {
      view.current?.destroy();
      view.current = null;
    };
  }, [name]);
  useEffect(() => {
    if (view.current) reloadText(view.current, text);
  }, [text]);
  return <div className="viewer__code" ref={host} />;
}

const openInBrowser = (url: string) => void openUrl(url).catch(() => {});

/**
 * A Markdown file rendered (S4). Links never navigate the window: web links open in the system
 * browser, the others (mail, relative, anchors) do nothing.
 */
function MarkdownPreview({ text, onOpenLink }: { text: string; onOpenLink: (url: string) => void }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  const onClick = (e: MouseEvent<HTMLElement>) => {
    const link = (e.target as Element).closest("a");
    if (!link) return;
    e.preventDefault();
    const href = link.getAttribute("href") ?? "";
    if (!/^https?:\/\//i.test(href)) return;
    try {
      onOpenLink(new URL(href).href);
    } catch {
      // Not a valid address (`http://` alone): nothing to open.
    }
  };
  // A middle click would open the link in a new window of the app's own.
  const onAuxClick = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as Element).closest("a")) e.preventDefault();
  };
  return (
    <article
      className="viewer__markdown"
      onClick={onClick}
      onAuxClick={onAuxClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** The file viewer pane (S1-S5): a file's text, read-only, next to its terminal. */
export function FileViewer({ path, load, onClose, onOpenLink = openInBrowser, subscribeOutput, prompt }: FileViewerProps) {
  const t = useT();
  const name = fileName(path);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const markdown = isMarkdown(name);
  /** Markdown shows rendered first; the switch shows its code. */
  const [mode, setMode] = useState<"preview" | "code">("preview");
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let live = true;
    setLoaded({ state: "loading" });
    loadRef.current().then(
      (file) => live && setLoaded({ state: "ok", file }),
      (err) => live && setLoaded({ state: "error", message: describeAttachError(err) }),
    );
    return () => {
      live = false;
    };
  }, [path]);

  /** Reads the file again; its new text replaces the shown one, a failed read keeps it. */
  const refreshRef = useRef<() => void>(() => {});
  refreshRef.current = () => {
    loadRef.current().then(
      (file) =>
        setLoaded((prev) =>
          prev.state === "ok" && prev.file.content === file.content && prev.file.truncated === file.truncated
            ? prev
            : { state: "ok", file },
        ),
      () => {},
    );
  };
  const firstPrompt = useRef(prompt);
  useEffect(() => {
    if (prompt !== firstPrompt.current) refreshRef.current();
  }, [prompt]);
  useEffect(() => {
    if (!subscribeOutput) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = subscribeOutput(() => {
      timer ??= setTimeout(() => {
        timer = null;
        refreshRef.current();
      }, REFRESH_MS);
    });
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [subscribeOutput]);

  return (
    <section className="viewer" aria-label={name}>
      <header className="viewer__header">
        <h2 className="viewer__name" title={path}>
          {name}
        </h2>
        {markdown && (
          <div className="viewer__modes" role="radiogroup" aria-label={t("app.viewer.mode")}>
            {(["code", "preview"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                className={`viewer__mode${mode === m ? " viewer__mode--on" : ""}`}
                onClick={() => setMode(m)}
              >
                {t(m === "code" ? "app.viewer.code" : "app.viewer.preview")}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="viewer__close" aria-label={t("app.viewer.close")} title={t("app.viewer.close")} onClick={onClose}>
          <X size={14} aria-hidden="true" />
        </button>
      </header>
      {loaded.state === "loading" && <p className="sidebar__note">{t("app.viewer.loading")}</p>}
      {loaded.state === "error" && (
        <p className="sidebar__note form-error" role="alert">
          {loaded.message}
        </p>
      )}
      {loaded.state === "ok" && (
        <>
          {loaded.file.truncated && (
            <p className="sidebar__note" role="note">
              {t("app.viewer.truncated")}
            </p>
          )}
          {markdown && mode === "preview" ? (
            <MarkdownPreview text={loaded.file.content} onOpenLink={onOpenLink} />
          ) : (
            <CodeView text={loaded.file.content} name={name} />
          )}
        </>
      )}
    </section>
  );
}
