import { save } from "@tauri-apps/plugin-dialog";
import { Copy, KeyRound, Save, Upload } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { chainTarget, collectLogins, hopLabel, patchJump, type PasswordAnswer } from "../../sessions/jumpHosts";
import { resolveChain, type SavedSession } from "../../sessions/library";
import { PasswordPrompt } from "../../sessions/PasswordPrompt";
import { secretExists } from "../../sessions/secrets";
import type { SshTarget } from "../../sessions/types";
import { HostKeyPrompt } from "../../ssh/HostKeyPrompt";
import { describeSshError, toSshError } from "../../ssh/sshErrors";
import { writeText } from "../../terminal/clipboard";
import {
  describeKeygenError,
  discardKey,
  generateKey,
  installKey,
  isKeygenError,
  saveKey,
  type GeneratedKey,
} from "./keygenBackend";
import "./KeyGenDialog.css";

interface KeyGenDialogProps {
  /** Saved SSH sessions of the library (also used to resolve jump hosts). */
  sessions: SavedSession[];
  onClose: () => void;
}

/** An install waiting for the user to trust a host key. */
interface PendingTrust {
  session: SavedSession;
  target: SshTarget;
  trusted: string | null;
  host: string;
  fingerprint: string;
  otherKnownKeys: string[];
  /** Jump host position (1-based) when the unknown host is a jump host. */
  hop?: number;
  via?: string;
}

/**
 * Tools > SSH key generator: generates an Ed25519 key in the backend, shows and copies
 * its public key, saves the pair to files and installs the public key on a saved
 * session (like ssh-copy-id). The private key only ever exists in the backend and the file.
 */
export function KeyGenDialog({ sessions, onClose }: KeyGenDialogProps) {
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [comment, setComment] = useState("");
  const [key, setKey] = useState<GeneratedKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [overwritePath, setOverwritePath] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? "");
  const [asking, setAsking] = useState<{ label: string; resolve: (a: PasswordAnswer | null) => void } | null>(null);
  const [trust, setTrust] = useState<PendingTrust | null>(null);
  const keyId = useRef<number | null>(null);

  const report = (message: string | null, failure: string | null = null) => {
    setStatus(message);
    setError(failure);
  };

  const close = () => {
    if (keyId.current !== null) void discardKey(keyId.current).catch(() => {});
    onClose();
  };

  const generate = async (e: FormEvent) => {
    e.preventDefault();
    if (passphrase !== confirm) return report(null, "The passphrases do not match.");
    setBusy(true);
    try {
      const generated = await generateKey(passphrase || null, comment.trim());
      if (keyId.current !== null) void discardKey(keyId.current).catch(() => {});
      keyId.current = generated.id;
      setKey(generated);
      setOverwritePath(null);
      report(passphrase ? "Key generated (protected by its passphrase)." : "Key generated (no passphrase).");
    } catch (err) {
      report(null, describeKeygenError(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!key) return;
    try {
      await writeText(key.publicKey);
      report("Public key copied to the clipboard.");
    } catch (err) {
      report(null, `Cannot copy: ${String(err)}`);
    }
  };

  const write = async (path: string, overwrite: boolean) => {
    if (!key) return;
    setOverwritePath(null);
    try {
      await saveKey(key.id, path, overwrite);
      report(`Saved the private key to ${path} and the public key to ${path}.pub.`);
    } catch (err) {
      if (isKeygenError(err) && err.kind === "exists") {
        setOverwritePath(path);
        report(null, `${err.path} already exists. Overwrite it?`);
      } else {
        report(null, describeKeygenError(err));
      }
    }
  };

  const saveAs = async () => {
    const path = await save({ title: "Save the private key", defaultPath: "id_ed25519" });
    if (path) await write(path, false);
  };

  const askPassword = (label: string) =>
    new Promise<PasswordAnswer | null>((resolve) => setAsking({ label, resolve }));

  const runInstall = async (session: SavedSession, target: SshTarget, trusted: string | null) => {
    if (!key) return;
    setBusy(true);
    report(`Installing the key on ${session.name}…`);
    try {
      const outcome = await installKey(key.id, target, trusted);
      report(
        outcome === "added"
          ? `The key was added to ~/.ssh/authorized_keys on ${session.name}.`
          : `The key was already installed on ${session.name}.`,
      );
    } catch (raw) {
      const err = toSshError(raw);
      if (err.kind === "unknownHost") {
        setTrust({ session, target, trusted, ...err });
        report(null);
      } else if (err.kind === "hop" && err.error.kind === "unknownHost") {
        const { host, fingerprint, otherKnownKeys } = err.error;
        setTrust({ session, target, trusted, host, fingerprint, otherKnownKeys, hop: err.hop, via: err.name });
        report(null);
      } else {
        report(null, describeSshError(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return report(null, "Choose a saved SSH session.");
    const chain = resolveChain({ sessions }, session);
    if (!chain.ok) return report(null, chain.error);
    const hops = [...chain.jumps, session];
    const logins = await collectLogins(hops, {
      secretExists,
      askPassword: (index) => askPassword(hopLabel(hops, index)),
    });
    if (!logins) return report(null);
    await runInstall(session, chainTarget(hops, logins), null);
  };

  const trustHost = () => {
    if (!trust) return;
    setTrust(null);
    const { session, target, trusted, fingerprint, hop } = trust;
    if (hop === undefined) return void runInstall(session, target, fingerprint);
    const jumps = patchJump(target.jumps ?? [], hop - 1, { trustedFingerprint: fingerprint });
    void runInstall(session, { ...target, jumps }, trusted);
  };

  return (
    <>
      <div className="overlay" onKeyDown={(e) => e.key === "Escape" && close()}>
        <form className="dialog keygen" role="dialog" onSubmit={generate} aria-labelledby="keygen-title" noValidate>
          <h2 id="keygen-title">SSH key generator</h2>
          <p className="muted">Generates an Ed25519 key pair. The private key is only written to the file you choose.</p>
          <div className="form-row">
            <label className="field field--grow">
              Passphrase
              <input
                type="password"
                autoFocus
                autoComplete="new-password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </label>
            <label className="field field--grow">
              Confirm passphrase
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
          </div>
          <label className="field">
            Comment
            <input
              spellCheck={false}
              placeholder="user@host"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </label>
          <div className="keygen__row">
            <button type="submit" className="btn btn--primary btn--icon" disabled={busy}>
              <KeyRound size={14} aria-hidden />
              {key ? "Generate again" : "Generate"}
            </button>
          </div>

          {key && (
            <>
              <label className="field">
                Public key
                <textarea className="keygen__public" readOnly rows={3} value={key.publicKey} spellCheck={false} />
              </label>
              <p className="muted">
                Fingerprint: <code className="keygen__fingerprint">{key.fingerprint}</code>
              </p>
              <div className="keygen__row">
                <button type="button" className="btn btn--icon" onClick={copy}>
                  <Copy size={14} aria-hidden />
                  Copy
                </button>
                <button type="button" className="btn btn--icon" onClick={saveAs} disabled={busy}>
                  <Save size={14} aria-hidden />
                  Save…
                </button>
                {overwritePath && (
                  <>
                    <button type="button" className="btn keygen__danger" onClick={() => write(overwritePath, true)}>
                      Overwrite
                    </button>
                    <button type="button" className="btn" onClick={() => (setOverwritePath(null), report(null))}>
                      Keep the files
                    </button>
                  </>
                )}
              </div>
              {sessions.length > 0 && (
                <div className="form-row keygen__install">
                  <label className="field field--grow">
                    Saved session
                    <select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
                      {sessions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.username}@{s.host})
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="btn btn--icon" onClick={install} disabled={busy}>
                    <Upload size={14} aria-hidden />
                  Install
                  </button>
                </div>
              )}
            </>
          )}

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {status && <p role="status">{status}</p>}
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={close}>
              Close
            </button>
          </div>
        </form>
      </div>
      {asking && (
        <PasswordPrompt
          label={asking.label}
          onSubmit={(password, remember) => {
            setAsking(null);
            asking.resolve({ password, remember });
          }}
          onCancel={() => {
            setAsking(null);
            asking.resolve(null);
          }}
        />
      )}
      {trust && (
        <HostKeyPrompt
          host={trust.host}
          fingerprint={trust.fingerprint}
          otherKnownKeys={trust.otherKnownKeys}
          via={trust.via ? `${trust.via} — jump host ${trust.hop}` : undefined}
          onTrust={trustHost}
          onCancel={() => setTrust(null)}
        />
      )}
    </>
  );
}
