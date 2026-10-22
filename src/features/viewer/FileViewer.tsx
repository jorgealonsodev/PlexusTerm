import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Diff, RotateCw, Save, X } from "lucide-react";
import { useT } from "../../i18n/i18n";
import { describeAttachError, fileName } from "../ai/attachments";
import {
  createCodeView,
  fileText,
  fileTextLength,
  languageNames,
  languageOf,
  lineBreakOf,
  reloadText,
  setLanguage,
  setLineBreak,
  showChanges,
  type Editing,
  type LineBreak,
} from "./codeView";
import type { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { isMarkdown, renderMarkdown } from "./markdown";
import { ENCODINGS, encodingName, regionKey } from "./encodings";
import { StatusPicker, type PickerOption } from "./StatusPicker";

/** A file's text as the backend reads it for the viewer. */
export interface ViewedText {
  path: string;
  content: string;
  /** Only the first 4 MiB were read. */
  truncated: boolean;
  /** The encoding the text was read with (an id of ENCODINGS); UTF-8 when not said. */
  encoding?: string;
}

interface FileViewerProps {
  path: string;
  /** Asked before Reload drops unsaved edits; without it Reload is not offered while there are some. */
  confirmDiscard?: () => Promise<boolean>;
  /**
   * Reads the file, with `encoding` when one was chosen (otherwise the backend finds it); called
   * again when `path` changes.
   */
  load: (encoding?: string) => Promise<ViewedText>;
  onClose: () => void;
  /** Opens a web link of a Markdown preview; the system browser by default. */
  onOpenLink?: (url: string) => void;
  /** Reads an image a Markdown file shows from its own disk (local or SFTP); without it they stay blank. */
  loadImage?: (path: string) => Promise<Blob>;
  /**
   * Listens to the output of the viewer's terminal: while it prints (an AI tool editing files) the
   * file is read again, at most once every REFRESH_MS. Returns the function that stops listening.
   */
  subscribeOutput?: (listener: (text: string, echo?: boolean) => void) => () => void;
  /** Changes each time the terminal's prompt comes back: the file is read again. */
  prompt?: number;
  /**
   * Writes `content` over the file while it still holds `expected` (the text the edits started
   * from) in `encoding`; `expected` is the file read with `readAs` (another one after "Save with
   * encoding"). Rejects with the reason otherwise. Without it the file is read-only.
   */
  save?: (expected: string, content: string, encoding: string, readAs: string) => Promise<void>;
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
  lineBreak,
  language,
}: {
  text: string;
  name: string;
  editing?: Editing;
  keep: boolean;
  /** The file's text in its last commit, to mark the lines that differ; null marks none. */
  committed: string | null;
  /** The line break chosen in the status bar (null: the text's own); choosing one is an edit. */
  lineBreak: LineBreak | null;
  /** The language highlighted, a name of `languageNames()`; null for plain text. */
  language: string | null;
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
  const lineBreakRef = useRef(lineBreak);
  lineBreakRef.current = lineBreak;
  /** The language the view highlights: the file name's when it is made. */
  const shownLanguage = useRef<string | null>(null);
  useEffect(() => {
    const relay: Editing | undefined = editingRef.current && {
      onEdit: (doc) => editingRef.current?.onEdit(doc),
      onSave: () => editingRef.current?.onSave(),
    };
    view.current = createCodeView(host.current!, textRef.current, name, relay, lineBreakRef.current ?? undefined);
    shownLanguage.current = languageOf(name);
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
  useEffect(() => {
    const v = view.current;
    // Only a choice converts: the text read again keeps its own line breaks.
    if (!v || lineBreak === null || v.state.lineBreak === lineBreak) return;
    setLineBreak(v, lineBreak);
    editingRef.current?.onEdit(v.state);
  }, [lineBreak]);
  useEffect(() => {
    if (!view.current || language === shownLanguage.current) return;
    setLanguage(view.current, language);
    shownLanguage.current = language;
  }, [language, name, editable]);
  return <div className="viewer__code" ref={host} />;
}

const openInBrowser = (url: string) => void openUrl(url).catch(() => {});

/**
 * A Markdown file rendered (S4). Links never navigate the window: web links open in the system
 * browser, the others (mail, relative, anchors) do nothing. The file's own images are read with
 * `loadImage` and shown from memory (`blob:`); one that cannot be read keeps its alternative text.
 */
function MarkdownPreview({
  text,
  path,
  onOpenLink,
  loadImage,
}: {
  text: string;
  path: string;
  onOpenLink: (url: string) => void;
  loadImage?: (path: string) => Promise<Blob>;
}) {
  const html = useMemo(() => renderMarkdown(text, path), [text, path]);
  const article = useRef<HTMLElement>(null);
  const loadImageRef = useRef(loadImage);
  loadImageRef.current = loadImage;
  useEffect(() => {
    const load = loadImageRef.current;
    if (!load || !article.current) return;
    let live = true;
    const urls: string[] = [];
    for (const img of article.current.querySelectorAll<HTMLImageElement>("img[data-file-src]")) {
      load(img.dataset.fileSrc!)
        .then((blob) => {
          if (!live) return;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          img.src = url;
        })
        .catch(() => {});
    }
    return () => {
      live = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [html]);
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
      ref={article}
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
  loadImage,
  subscribeOutput,
  prompt,
  save,
  autoSave = false,
  onDirtyChange,
  loadCommitted,
  showChanges: changesShown = false,
  onShowChangesChange,
  confirmDiscard,
}: FileViewerProps) {
  const t = useT();
  const name = fileName(path);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const markdown = isMarkdown(name);
  /** Markdown shows rendered first; the switch shows its code. */
  const [mode, setMode] = useState<"preview" | "code">("preview");
  const loadRef = useRef(load);
  loadRef.current = load;
  /** The encoding chosen to read the file with; the backend finds it until one is. */
  const readAs = useRef<string | undefined>(undefined);
  /** The line break chosen in the status bar; the file's own one until then. */
  const [lineBreak, setLineBreakChoice] = useState<LineBreak | null>(null);
  /** The language chosen in the status bar (null: plain text); the file name's until then. */
  const [language, setLanguageChoice] = useState<string | null | undefined>(undefined);
  /** The open status bar list, and the button it opens from. */
  const [picker, setPicker] = useState<{ kind: "encoding" | "reopen" | "saveAs" | "lineBreak" | "language"; anchor: HTMLElement } | null>(null);

  /** The edited text while it differs from the file's; null when there is nothing to save. */
  const draft = useRef<EditorState | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** An encoding chosen with "Save with encoding" while a save was running: saved with once it ends. */
  const pendingEncoding = useRef<string | null>(null);
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

  /** Reads the file from scratch: shown edits and a chosen line break are dropped. */
  const readSeq = useRef(0);
  const read = useCallback(() => {
    const seq = ++readSeq.current;
    setLoaded({ state: "loading" });
    draft.current = null;
    setDirty(false);
    setSaveError(null);
    setLineBreakChoice(null);
    stopAutoSave();
    loadRef.current(readAs.current).then(
      (file) => seq === readSeq.current && setLoaded({ state: "ok", file }),
      (err) => seq === readSeq.current && setLoaded({ state: "error", message: describeAttachError(err) }),
    );
  }, []);
  useEffect(() => {
    readAs.current = undefined;
    setLanguageChoice(undefined);
    read();
    return () => {
      readSeq.current++;
    };
  }, [path, read]);

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
    loadRef.current(readAs.current).then(
      (file) =>
        // Unsaved edits are kept; saving says if the file changed meanwhile.
        dirtyRef.current ||
        setLoaded((prev) => {
          if (prev.state === "ok" && prev.file.content === file.content && prev.file.truncated === file.truncated) return prev;
          // The file's new text has its own line breaks.
          setLineBreakChoice(null);
          return { state: "ok", file };
        }),
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
  const encoding = file?.encoding ?? "utf-8";
  /** Saves the edits; with `as`, the text (edited or not) in that encoding, which it keeps. */
  const saveRef = useRef<(as?: string) => void>(() => {});
  saveRef.current = (as?: string) => {
    stopAutoSave();
    const edited = draft.current;
    if (!save || !file || !(edited || as) || !editable) return;
    if (saving) {
      // The newer text is saved once the running save is done; a chosen encoding right after it.
      if (as) pendingEncoding.current = as;
      else if (autoSave) autoSaveTimer.current = setTimeout(() => saveRef.current(), AUTO_SAVE_MS);
      return;
    }
    const content = edited ? fileText(edited) : file.content;
    const target = as ?? encoding;
    setSaving(true);
    const afterSave = () => {
      const pending = pendingEncoding.current;
      pendingEncoding.current = null;
      if (pending) setTimeout(() => saveRef.current(pending));
    };
    save(file.content, content, target, encoding).then(
      () => {
        setSaving(false);
        afterSave();
        setSaveError(null);
        // Typing during the save keeps the newer text to save.
        if (draft.current === edited) {
          draft.current = null;
          setDirty(false);
        }
        // Later reads decode it as it was written.
        if (as) readAs.current = as;
        setLoaded({ state: "ok", file: { ...file, content, encoding: target } });
      },
      (err) => {
        setSaving(false);
        setSaveError(describeAttachError(err));
        afterSave();
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
  const fileLineBreak = lineBreak ?? lineBreakOf(file?.content ?? "");
  const shownLanguage = language === undefined ? languageOf(name) : language;
  const plainText = t("app.viewer.plainText");
  const openPicker = (kind: NonNullable<typeof picker>["kind"]) => (e: MouseEvent<HTMLButtonElement>) => {
    const anchor = e.currentTarget;
    setPicker((open) => (open?.anchor === anchor && open.kind === kind ? null : { kind, anchor }));
  };
  const encodingOptions: PickerOption[] = ENCODINGS.map((e) => ({
    id: e.id,
    label: `${encodingName(e.id, t)} — ${t(regionKey(e.region))}`,
  }));
  const pickers = picker && {
    encoding: {
      label: t("app.viewer.selectAction"),
      options: [
        // Reading it again would drop the edits.
        ...(dirty ? [] : [{ id: "reopen", label: t("app.viewer.reopenWithEncoding") }]),
        ...(editable ? [{ id: "saveAs", label: t("app.viewer.saveWithEncoding") }] : []),
      ],
      onChoose: (id: string) => setPicker({ kind: id as "reopen" | "saveAs", anchor: picker.anchor }),
    },
    reopen: {
      label: t("app.viewer.selectEncoding"),
      options: encodingOptions,
      selected: encoding,
      filter: true,
      onChoose: (id: string) =>
        loadRef.current(id).then(
          (reopened) => {
            readAs.current = id;
            draft.current = null;
            setDirty(false);
            setSaveError(null);
            setLineBreakChoice(null);
            setLoaded({ state: "ok", file: reopened });
          },
          // The file stays as it was shown, read as before.
          (err) => setSaveError(describeAttachError(err)),
        ),
    },
    saveAs: {
      label: t("app.viewer.selectEncoding"),
      options: encodingOptions,
      selected: encoding,
      filter: true,
      onChoose: (id: string) => saveRef.current(id),
    },
    lineBreak: {
      label: t("app.viewer.selectLineBreak"),
      options: [
        { id: "\n", label: "LF" },
        { id: "\r\n", label: "CRLF" },
      ],
      selected: fileLineBreak,
      onChoose: (id: string) => setLineBreakChoice(id as LineBreak),
    },
    language: {
      label: t("app.viewer.selectLanguage"),
      options: [{ id: "", label: plainText }, ...languageNames().map((n) => ({ id: n, label: n }))],
      selected: shownLanguage ?? "",
      filter: true,
      onChoose: (id: string) => setLanguageChoice(id === "" ? null : id),
    },
  }[picker.kind];

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
        <button
          type="button"
          className="viewer__reload"
          aria-label={t("app.viewer.reload")}
          title={t("app.viewer.reload")}
          disabled={saving || (dirty && !confirmDiscard)}
          onClick={async () => {
            // Unsaved edits are dropped only once the user agrees.
            if (dirtyRef.current && !(await confirmDiscard?.())) return;
            read();
            readCommitted();
          }}
        >
          <RotateCw size={14} aria-hidden="true" />
        </button>
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
            <MarkdownPreview text={shown} path={path} onOpenLink={onOpenLink} loadImage={loadImage} />
          ) : (
            <CodeView
              text={dirty ? shown : loaded.file.content}
              name={name}
              editing={editing}
              keep={dirty}
              committed={changesShown ? committed : null}
              lineBreak={lineBreak}
              language={shownLanguage}
            />
          )}
          <div className="pane-footer viewer__status" role="toolbar" aria-label={t("app.viewer.status")}>
            <button
              type="button"
              className="viewer__status-item"
              title={t("app.viewer.selectEncoding")}
              disabled={dirty && !editable}
              onClick={openPicker("encoding")}
            >
              {encodingName(encoding, t)}
            </button>
            <button
              type="button"
              className="viewer__status-item"
              title={t("app.viewer.selectLineBreak")}
              // Converting is an edit of the code: not of a file shown only in part, nor while rendered.
              disabled={!editable || (markdown && mode === "preview")}
              onClick={openPicker("lineBreak")}
            >
              {fileLineBreak === "\r\n" ? "CRLF" : "LF"}
            </button>
            <button
              type="button"
              className="viewer__status-item"
              title={t("app.viewer.selectLanguage")}
              onClick={openPicker("language")}
            >
              {shownLanguage ?? plainText}
            </button>
          </div>
          {picker && pickers && (
            <StatusPicker key={picker.kind} anchor={picker.anchor} onClose={() => setPicker(null)} {...pickers} />
          )}
        </>
      )}
    </section>
  );
}
