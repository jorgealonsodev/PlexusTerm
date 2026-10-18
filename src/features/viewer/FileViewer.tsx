import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useT } from "../../i18n/i18n";
import { describeAttachError, fileName } from "../ai/attachments";
import { createCodeView } from "./codeView";

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
}

type Loaded = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; file: ViewedText };

/** The text of a file in a CodeMirror view. */
function CodeView({ text, name }: { text: string; name: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const view = createCodeView(host.current!, text, name);
    return () => view.destroy();
  }, [text, name]);
  return <div className="viewer__code" ref={host} />;
}

/** The file viewer pane (S1-S5): a file's text, read-only, next to its terminal. */
export function FileViewer({ path, load, onClose }: FileViewerProps) {
  const t = useT();
  const name = fileName(path);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
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

  return (
    <section className="viewer" aria-label={name}>
      <header className="viewer__header">
        <h2 className="viewer__name" title={path}>
          {name}
        </h2>
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
          <CodeView text={loaded.file.content} name={name} />
        </>
      )}
    </section>
  );
}
