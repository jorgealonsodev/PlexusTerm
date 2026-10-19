import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Diff, Save, X } from "lucide-react";
import { useT } from "../../i18n/i18n";
import { describeAttachError, fileName } from "../ai/attachments";
import { createCodeView, fileText, fileTextLength, reloadText, showChanges, type Editing } from "./codeView";
import type { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
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
  subscribeOutput?: (listener: (text: string, echo?: boolean) => void) => () => void;
  /** Changes each time the terminal's prompt comes back: the file is read again. */
  prompt?: number;
  /**
   * Writes `content` over the file while it still holds `expected` (the text the edits started
   * from); rejects with the reason otherwise. Without it the file is read-only.
   */
  save?: (expected: string, content: string) => Promise<void>;
  /** Saves by itself AUTO_SAVE_MS after typing stops. */
  autoSave?: boolean;
  /** Told when the viewer starts or stops holding unsaved edits (and that it holds none once closed). */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Reads the file's text in its last commit (null when it has none). Given, a button next to Save
   * marks the lines that differ from it, as VS Code does.
   */
  loadCommitted?: () => Promise<string | null>;
  /** The changed lines are marked (the button is pressed). */
  showChanges?: boolean;
  onShowChangesChange?: (show: boolean) => void;
}

/** The file is read again at most this often while its terminal prints. */
export const REFRESH_MS = 1000;
/** With auto-save on, the file is saved this long after the last edit. */
export const AUTO_SAVE_MS = 1000;

type Loaded = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; file: ViewedText };

/**
 * The text of a file in a CodeMirror view; a new text replaces the old one in the same view,
 * unless `keep` says the view holds edits not saved yet.
 */
function CodeView({
  text,
  name,
  editing,
  keep,
  committed,
}: {
  text: string;
  name: string;
  editing?: Editing;
  keep: boolean;
  /** The file's text in its last commit, to mark the lines that differ; null marks none. */
  committed: string | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const editable = editing !== undefined;
  const committedRef = useRef(committed);
  committedRef.current = committed;
  useEffect(() => {
    const relay: Editing | undefined = editingRef.current && {
      onEdit: (doc) => editingRef.current?.onEdit(doc),
      onSave: () => editingRef.current?.onSave(),
    };
    view.current = createCodeView(host.current!, textRef.current, name, relay);
    showChanges(view.current, committedRef.current);
    return () => {
      view.current?.destroy();
      view.current = null;
    };
  }, [name, editable]);
  const keepRef = useRef(keep);
  keepRef.current = keep;
  useEffect(() => {
    if (view.current && !keepRef.current) reloadText(view.current, text);
  }, [text]);
  useEffect(() => {
    if (view.current) showChanges(view.current, committed);
  }, [committed]);
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

/**
 * The file viewer pane (S1-S5): a file's text next to its terminal, editable when it can be saved
 * and was read whole.
 */
export function FileViewer({
  path,
  load,
  onClose,
  onOpenLink = openInBrowser,
  subscribeOutput,
  prompt,
  save,
  autoSave = false,
  onDirtyChange,
  loadCommitted,
  showChanges: changesShown = false,
  onShowChangesChange,
}: FileViewerProps) {
  const t = useT();
  const name = fileName(path);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const markdown = isMarkdown(name);
  /** Markdown shows rendered first; the switch shows its code. */
  const [mode, setMode] = useState<"preview" | "code">("preview");
  const loadRef = useRef(load);
  loadRef.current = load;

  /** The edited text while it differs from the file's; null when there is nothing to save. */
  const draft = useRef<EditorState | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopAutoSave = () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = null;
  };
  useEffect(() => stopAutoSave, []);
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  useEffect(() => {
    onDirtyChangeRef.current?.(dirty);
    return () => {
      if (dirty) onDirtyChangeRef.current?.(false);
    };
  }, [dirty]);

  useEffect(() => {
    let live = true;
    setLoaded({ state: "loading" });
    draft.current = null;
    setDirty(false);
    setSaveError(null);
    stopAutoSave();
    loadRef.current().then(
      (file) => live && setLoaded({ state: "ok", file }),
      (err) => live && setLoaded({ state: "error", message: describeAttachError(err) }),
    );
    return () => {
      live = false;
    };
  }, [path]);

  /** The file's text in its last commit while the changed lines are shown; null otherwise. */
  const [committed, setCommitted] = useState<string | null>(null);
  const loadCommittedRef = useRef(loadCommitted);
  loadCommittedRef.current = loadCommitted;
  const committedSeq = useRef(0);
  const readCommitted = useCallback(() => {
    const seq = ++committedSeq.current;
    const read = changesShown ? loadCommittedRef.current : undefined;
    if (!read) return setCommitted(null);
    read().then(
      (text) => seq === committedSeq.current && setCommitted(text),
      () => seq === committedSeq.current && setCommitted(null),
    );
  }, [changesShown]);
  useEffect(() => {
    readCommitted();
  }, [path, readCommitted]);

  /** Reads the file again; its new text replaces the shown one, a failed read keeps it. */
  const refreshRef = useRef<() => void>(() => {});
  refreshRef.current = () => {
    loadRef.current().then(
      (file) =>
        // Unsaved edits are kept; saving says if the file changed meanwhile.
        dirtyRef.current ||
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
    if (prompt === firstPrompt.current) return;
    refreshRef.current();
    // A command may have committed the file.
    readCommitted();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt]);
  useEffect(() => {
    if (!subscribeOutput) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = subscribeOutput((_text, echo) => {
      // The echo of a key changes no file.
      if (echo) return;
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

  const file = loaded.state === "ok" ? loaded.file : null;
  const editable = save !== undefined && file !== null && !file.truncated;
  const saveRef = useRef<() => void>(() => {});
  saveRef.current = () => {
    stopAutoSave();
    const edited = draft.current;
    if (!save || !file || !edited) return;
    if (saving) {
      // The newer text is saved once the running save is done.
      if (autoSave) autoSaveTimer.current = setTimeout(() => saveRef.current(), AUTO_SAVE_MS);
      return;
    }
    const content = fileText(edited);
    setSaving(true);
    save(file.content, content).then(
      () => {
        setSaving(false);
        setSaveError(null);
        // Typing during the save keeps the newer text to save.
        if (draft.current === edited) {
          draft.current = null;
          setDirty(false);
        }
        setLoaded({ state: "ok", file: { ...file, content } });
      },
      (err) => {
        setSaving(false);
        setSaveError(describeAttachError(err));
      },
    );
  };
  const editing: Editing | undefined = editable
    ? {
        onEdit: (state) => {
          const base = file.content;
          const same = fileTextLength(state) === base.length && fileText(state) === base;
          draft.current = same ? null : state;
          setDirty(!same);
          stopAutoSave();
          if (autoSave && !same) autoSaveTimer.current = setTimeout(() => saveRef.current(), AUTO_SAVE_MS);
        },
        onSave: () => saveRef.current(),
      }
    : undefined;
  const shown = dirty && draft.current ? fileText(draft.current) : (file?.content ?? "");

  return (
    <section className="viewer" aria-label={name}>
      <header className="viewer__header">
        <h2 className="viewer__name" title={path}>
          {name}
        </h2>
        {dirty && (
          <span className="viewer__dirty" aria-label={t("app.viewer.unsaved")} title={t("app.viewer.unsaved")}>
            ●
          </span>
        )}
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
        {loadCommitted && (
          <button
            type="button"
            className={`viewer__changes${changesShown ? " viewer__changes--on" : ""}`}
            aria-label={t("app.viewer.changedLines")}
            aria-pressed={changesShown}
            title={t("app.viewer.changedLinesHint")}
            onClick={() => onShowChangesChange?.(!changesShown)}
          >
            <Diff size={14} aria-hidden="true" />
          </button>
        )}
        {save && (
          <button
            type="button"
            className="viewer__save"
            aria-label={t("app.viewer.save")}
            title={t("app.viewer.saveHint")}
            disabled={!editable || !dirty || saving}
            onClick={() => saveRef.current()}
          >
            <Save size={14} aria-hidden="true" />
          </button>
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
      {saveError && (
        <p className="sidebar__note form-error" role="alert">
          {saveError}
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
            <MarkdownPreview text={shown} onOpenLink={onOpenLink} />
          ) : (
            <CodeView
              text={dirty ? shown : loaded.file.content}
              name={name}
              editing={editing}
              keep={dirty}
              committed={changesShown ? committed : null}
            />
          )}
        </>
      )}
    </section>
  );
}
