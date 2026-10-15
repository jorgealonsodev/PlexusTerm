import { otherKeysWarning } from "./sshErrors";
import { useT } from "../../i18n/i18n";

interface HostKeyPromptProps {
  host: string;
  fingerprint: string;
  otherKnownKeys: string[];
  /** Set when the host is a jump host, e.g. "bastion — jump host 1 of 2". */
  via?: string;
  onTrust: () => void;
  onCancel: () => void;
}

export function HostKeyPrompt({ host, fingerprint, otherKnownKeys, via, onTrust, onCancel }: HostKeyPromptProps) {
  const t = useT();
  // The host is shown in bold inside the translated sentence.
  const [before, after = ""] = t("sessions.hostKey.authenticity", { via: via ? ` (${via})` : "" }).split("{host}");
  return (
    <div className="overlay" role="alertdialog" aria-labelledby="hostkey-title">
      <div className="dialog">
        <h2 id="hostkey-title">{via ? t("sessions.hostKey.unknownJumpHost") : t("sessions.hostKey.unknownHost")}</h2>
        <p>
          {before}
          <strong>{host}</strong>
          {after}
        </p>
        <code className="fingerprint">{fingerprint}</code>
        {otherKnownKeys.length > 0 && (
          <p className="form-error" role="alert">
            {otherKeysWarning(otherKnownKeys)}
          </p>
        )}
        <p className="muted">{t("sessions.hostKey.knownHostsNote")}</p>
        <div className="dialog__actions">
          <button className="btn" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button className="btn btn--primary" onClick={onTrust} autoFocus>
            {t("sessions.hostKey.trust")}
          </button>
        </div>
      </div>
    </div>
  );
}
