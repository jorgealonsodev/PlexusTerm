import { useState } from "react";
import { useT } from "../../i18n/i18n";

interface PasteConfirmProps {
  lineCount: number;
  /** The first lines of the pasted text. */
  preview: string[];
  /** `dontAskAgain` turns the confirmation off for later pastes. */
  onPaste: (dontAskAgain: boolean) => void;
  onCancel: () => void;
}

/** Asks before a multi-line paste runs several commands at once (S15.3). */
export function PasteConfirm({ lineCount, preview, onPaste, onCancel }: PasteConfirmProps) {
  const t = useT();
  const [dontAsk, setDontAsk] = useState(false);
  const more = lineCount > preview.length ? "\n…" : "";
  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <div className="dialog" role="dialog" aria-labelledby="paste-title">
        <h2 id="paste-title">{t("terminal.paste.title", { count: lineCount })}</h2>
        <p>{t("terminal.paste.warning")}</p>
        <pre className="paste-preview" data-testid="paste-preview">
          {preview.join("\n") + more}
        </pre>
        <label className="check">
          <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
          {t("terminal.paste.dontAsk")}
        </label>
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn btn--primary" autoFocus onClick={() => onPaste(dontAsk)}>
            {t("terminal.paste.paste")}
          </button>
        </div>
      </div>
    </div>
  );
}
