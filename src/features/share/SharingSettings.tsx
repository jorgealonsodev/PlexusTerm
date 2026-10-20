import { useEffect, useState } from "react";
import { useT } from "../../i18n/i18n";
import { MAX_SHARE_URL_LENGTH } from "../settings/settings";
import { deleteRelayToken, relayTokenSaved, saveRelayToken } from "./shareApi";

export interface SharingValues {
  shareRelayUrl: string;
  shareViewerOrigin: string;
  shareViewNeedsApproval: boolean;
  shareSudoReset: boolean;
  shareBlockLid: boolean;
  shareRecordInput: boolean;
}

interface SharingSettingsProps {
  values: SharingValues;
  onChange: (patch: Partial<SharingValues>) => void;
  /** Linux only offers blocking lid-close sleep. */
  linux: boolean;
  onAuditLog: () => void;
}

type TokenStatus = "checking" | "saved" | "none" | "unavailable";

/**
 * The relay token in the system keyring: only whether one is saved is ever shown. Saving and
 * removing apply at once, not on Save.
 */
function RelayTokenField() {
  const t = useT();
  const [status, setStatus] = useState<TokenStatus>("checking");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    void Promise.resolve()
      .then(relayTokenSaved)
      .then((saved) => current && setStatus(saved ? "saved" : "none"))
      .catch(() => current && setStatus("unavailable"));
    return () => {
      current = false;
    };
  }, []);

  const run = (action: () => Promise<unknown>, after: TokenStatus) => {
    setBusy(true);
    setError(null);
    Promise.resolve()
      .then(action)
      .then(() => {
        setStatus(after);
        setToken("");
      })
      .catch((err) => setError(t("share.settings.tokenFailed", { error: String(err) })))
      .finally(() => setBusy(false));
  };

  const label = {
    checking: t("share.settings.tokenChecking"),
    saved: t("share.settings.tokenSaved"),
    none: t("share.settings.tokenNone"),
    unavailable: t("share.settings.tokenUnavailable"),
  };
  return (
    <div className="field">
      <label htmlFor="settings-share-token">{t("share.settings.token")}</label>
      <div className="form-row field__picker">
        <input
          id="settings-share-token"
          type="password"
          autoComplete="off"
          value={token}
          placeholder={t(status === "saved" ? "share.settings.tokenReplacePlaceholder" : "share.settings.tokenPlaceholder")}
          onChange={(e) => setToken(e.target.value)}
        />
        <button type="button" className="btn" disabled={busy || !token.trim()} onClick={() => run(() => saveRelayToken(token.trim()), "saved")}>
          {t("share.settings.saveToken")}
        </button>
        <button type="button" className="btn" disabled={busy || status !== "saved"} onClick={() => run(deleteRelayToken, "none")}>
          {t("share.settings.removeToken")}
        </button>
      </div>
      <span className="muted">{label[status]}</span>
      {error && <span className="form-error">{error}</span>}
    </div>
  );
}

/** Settings > Sharing (integration guide §5). */
export function SharingSettings({ values, onChange, linux, onAuditLog }: SharingSettingsProps) {
  const t = useT();
  return (
    <>
      <p className="muted">{t("share.settings.intro")}</p>
      <label className="field">
        {t("share.settings.relayUrl")}
        <input
          value={values.shareRelayUrl}
          placeholder="wss://relay.example.com"
          maxLength={MAX_SHARE_URL_LENGTH}
          spellCheck={false}
          onChange={(e) => onChange({ shareRelayUrl: e.target.value })}
        />
      </label>
      <p className="muted">{t("share.settings.relayUrlHelp")}</p>
      <label className="field">
        {t("share.settings.viewerOrigin")}
        <input
          value={values.shareViewerOrigin}
          placeholder="https://view.example.com"
          maxLength={MAX_SHARE_URL_LENGTH}
          spellCheck={false}
          onChange={(e) => onChange({ shareViewerOrigin: e.target.value })}
        />
      </label>
      <p className="muted">{t("share.settings.viewerOriginHelp")}</p>
      <RelayTokenField />
      <label className="check">
        <input
          type="checkbox"
          checked={values.shareViewNeedsApproval}
          onChange={(e) => onChange({ shareViewNeedsApproval: e.target.checked })}
        />
        {t("share.settings.viewNeedsApproval")}
      </label>
      <p className="muted">{t("share.settings.viewNeedsApprovalHelp")}</p>
      <label className="check">
        <input type="checkbox" checked={values.shareSudoReset} onChange={(e) => onChange({ shareSudoReset: e.target.checked })} />
        {t("share.settings.sudoReset")}
      </label>
      {linux && (
        <label className="check">
          <input type="checkbox" checked={values.shareBlockLid} onChange={(e) => onChange({ shareBlockLid: e.target.checked })} />
          {t("share.settings.blockLid")}
        </label>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={values.shareRecordInput}
          onChange={(e) => onChange({ shareRecordInput: e.target.checked })}
        />
        {t("share.settings.recordInput")}
      </label>
      <p className="muted">{t("share.settings.recordInputHelp")}</p>
      <div className="form-row">
        <button type="button" className="btn" onClick={onAuditLog}>
          {t("share.settings.auditLog")}
        </button>
      </div>
    </>
  );
}
