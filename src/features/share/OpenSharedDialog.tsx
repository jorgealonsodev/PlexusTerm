import { useState, type FormEvent } from "react";
import { useT } from "../../i18n/i18n";
import type { SharedTarget } from "../sessions/types";
import { resolveShareLink, type ResolvedLink } from "./viewApi";

interface OpenSharedDialogProps {
  onOpen: (target: SharedTarget) => void;
  onCancel: () => void;
}

/**
 * Opens a pasted share link as a pane (PRD-share §4.2.4): the link's viewer page names its relay,
 * and nothing connects to that relay until the user confirms "Connect to share on <relay-host>?".
 */
export function OpenSharedDialog({ onOpen, onCancel }: OpenSharedDialogProps) {
  const t = useT();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ResolvedLink | null>(null);

  const check = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    resolveShareLink(url.trim())
      .then(setResolved)
      .catch((err) => setError(String(err)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      {resolved ? (
        <div className="dialog" role="dialog" aria-labelledby="open-shared-title">
          <h2 id="open-shared-title">{t("share.view.title")}</h2>
          <p>{t("share.view.confirm", { host: resolved.relayHost })}</p>
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onCancel}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              autoFocus
              onClick={() => onOpen({ type: "shared", url: url.trim(), ...resolved })}
            >
              {t("share.view.connect")}
            </button>
          </div>
        </div>
      ) : (
        <form className="dialog" aria-labelledby="open-shared-title" onSubmit={check} noValidate>
          <h2 id="open-shared-title">{t("share.view.title")}</h2>
          <p className="muted">{t("share.view.help")}</p>
          <label className="field">
            {t("share.view.link")}
            <input
              autoFocus
              value={url}
              spellCheck={false}
              autoComplete="off"
              placeholder="https://view.example.com/s/…#…"
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          {busy && <p role="status">{t("share.view.checking")}</p>}
          {error && <p className="form-error">{error}</p>}
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onCancel}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy || !url.trim()}>
              {t("share.view.openButton")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
