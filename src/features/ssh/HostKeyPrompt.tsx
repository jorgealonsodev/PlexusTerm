import { otherKeysWarning } from "./sshErrors";

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
  return (
    <div className="overlay" role="alertdialog" aria-labelledby="hostkey-title">
      <div className="dialog">
        <h2 id="hostkey-title">{via ? "Unknown jump host" : "Unknown host"}</h2>
        <p>
          The authenticity of <strong>{host}</strong>
          {via && ` (${via})`} can't be established. Check that this
          fingerprint matches the server before trusting it:
        </p>
        <code className="fingerprint">{fingerprint}</code>
        {otherKnownKeys.length > 0 && (
          <p className="form-error" role="alert">
            {otherKeysWarning(otherKnownKeys)}
          </p>
        )}
        <p className="muted">Trusting it adds the key to ~/.ssh/known_hosts.</p>
        <div className="dialog__actions">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={onTrust} autoFocus>
            Trust and connect
          </button>
        </div>
      </div>
    </div>
  );
}
