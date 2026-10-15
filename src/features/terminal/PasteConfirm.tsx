import { useState } from "react";

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
  const [dontAsk, setDontAsk] = useState(false);
  const more = lineCount > preview.length ? "\n…" : "";
  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <div className="dialog" role="dialog" aria-labelledby="paste-title">
        <h2 id="paste-title">Paste {lineCount} lines?</h2>
        <p>Every line may run as a command.</p>
        <pre className="paste-preview" data-testid="paste-preview">
          {preview.join("\n") + more}
        </pre>
        <label className="check">
          <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
          Don't ask again
        </label>
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" autoFocus onClick={() => onPaste(dontAsk)}>
            Paste
          </button>
        </div>
      </div>
    </div>
  );
}
