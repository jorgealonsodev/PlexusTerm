import { open, save } from "@tauri-apps/plugin-dialog";
import { Check, Copy, FolderOpen, KeyRound, Save, Upload } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import type { AppKey } from "../../../i18n/catalogs";
import { useT } from "../../../i18n/i18n";
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
  loadKey,
  saveKeyFile,
  updateKey,
  type GeneratedKey,
  type KeyType,
  type SaveKind,
} from "./keygenBackend";
import "./KeyGenDialog.css";

interface KeyGenDialogProps {
  /** Saved SSH sessions of the library (also used to resolve jump hosts). */
  sessions: SavedSession[];
  onClose: () => void;
}

type Family = "ed25519" | "rsa" | "ecdsa";

const SIZES: Record<Exclude<Family, "ed25519">, string[]> = {
  rsa: ["2048", "3072", "4096"],
  ecdsa: ["256", "384", "521"],
};

function keyTypeOf(family: Family, rsaBits: string, ecdsaBits: string): KeyType {
  if (family === "rsa") return `rsa-${rsaBits}` as KeyType;
  if (family === "ecdsa") return `ecdsa-p${ecdsaBits}` as KeyType;
  return "ed25519";
}

/** `id_ed25519`, `id_rsa` or `id_ecdsa`, from the public key line. */
function defaultName(publicKey: string): string {
  if (publicKey.startsWith("ssh-rsa ")) return "id_rsa";
  if (publicKey.startsWith("ecdsa-")) return "id_ecdsa";
  return "id_ed25519";
}

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

const SAVE_TITLES: Record<SaveKind, AppKey> = {
  public: "tools.keygen.saveTitlePublic",
  private: "tools.keygen.saveTitlePrivate",
  ppk: "tools.keygen.saveTitlePpk",
};

const SAVED: Record<SaveKind, AppKey> = {
  public: "tools.keygen.savedPublic",
  private: "tools.keygen.savedPrivate",
  ppk: "tools.keygen.savedPpk",
};

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
 * Tools > SSH key generator: generates an Ed25519, RSA or ECDSA key in the backend or loads
 * a private key file (OpenSSH or PuTTY .ppk), shows and copies its public key, changes its
 * comment and passphrase, saves the public key, the private key or a .ppk file, and
 * installs the public key on a saved session (like ssh-copy-id). The private key only ever
 * exists in the backend and the files.
 */
export function KeyGenDialog({ sessions, onClose }: KeyGenDialogProps) {
  const t = useT();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [comment, setComment] = useState("");
  const [key, setKey] = useState<GeneratedKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [family, setFamily] = useState<Family>("ed25519");
  const [rsaBits, setRsaBits] = useState("3072");
  const [ecdsaBits, setEcdsaBits] = useState("256");
  /** The comment and passphrase the backend key has. */
  const [applied, setApplied] = useState({ comment: "", passphrase: "" });
  /** The file a loaded key came from (default save location). */
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  /** A key file waiting for its passphrase. */
  const [unlocking, setUnlocking] = useState<string | null>(null);
  const [unlockPassphrase, setUnlockPassphrase] = useState("");
  const [overwrite, setOverwrite] = useState<{ kind: SaveKind; path: string } | null>(null);
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

  /** Shows `next` instead of the current key, forgetting the old one in the backend. */
  const adopt = (next: GeneratedKey, nextPassphrase: string) => {
    if (keyId.current !== null && keyId.current !== next.id) void discardKey(keyId.current).catch(() => {});
    keyId.current = next.id;
    setKey(next);
    setApplied({ comment: next.comment, passphrase: nextPassphrase });
    setOverwrite(null);
  };

  const generate = async (e: FormEvent) => {
    e.preventDefault();
    if (passphrase !== confirm) return report(null, t("tools.keygen.passphraseMismatch"));
    setBusy(true);
    try {
      const generated = await generateKey(keyTypeOf(family, rsaBits, ecdsaBits), passphrase || null, comment.trim());
      adopt(generated, passphrase);
      setLoadedPath(null);
      report(passphrase ? t("tools.keygen.generatedProtected") : t("tools.keygen.generatedPlain"));
    } catch (err) {
      report(null, describeKeygenError(err));
    } finally {
      setBusy(false);
    }
  };

  const loadFrom = async (path: string, unlock: string | null) => {
    setBusy(true);
    try {
      const loaded = await loadKey(path, unlock);
      const kept = loaded.encrypted ? (unlock ?? "") : "";
      adopt(loaded, kept);
      setLoadedPath(path);
      setUnlocking(null);
      setUnlockPassphrase("");
      setComment(loaded.comment);
      setPassphrase(kept);
      setConfirm(kept);
      report(t(loaded.encrypted ? "tools.keygen.loadedProtected" : "tools.keygen.loadedPlain", { path }));
    } catch (err) {
      if (isKeygenError(err) && (err.kind === "passphraseRequired" || err.kind === "wrongPassphrase")) {
        setUnlocking(path);
        report(null, err.kind === "wrongPassphrase" ? describeKeygenError(err) : null);
      } else {
        report(null, describeKeygenError(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const pickKeyFile = async () => {
    const path = await open({ title: t("tools.keygen.loadTitle"), multiple: false, directory: false });
    if (typeof path === "string") await loadFrom(path, null);
  };

  const dirty = key !== null && (comment.trim() !== applied.comment || passphrase !== applied.passphrase);

  /** Sends a changed comment or passphrase to the backend; the key to use, or null. */
  const applyChanges = async (): Promise<GeneratedKey | null> => {
    if (!key) return null;
    if (!dirty) return key;
    if (passphrase !== confirm) {
      report(null, t("tools.keygen.passphraseMismatch"));
      return null;
    }
    try {
      const updated = await updateKey(key.id, comment.trim(), passphrase || null);
      adopt(updated, passphrase);
      return updated;
    } catch (err) {
      report(null, describeKeygenError(err));
      return null;
    }
  };

  const apply = async () => {
    const updated = await applyChanges();
    if (updated) report(t(updated.encrypted ? "tools.keygen.updatedProtected" : "tools.keygen.updatedPlain"));
  };

  const copy = async () => {
    if (!key) return;
    try {
      await writeText(key.publicKey);
      report(t("tools.keygen.copied"));
    } catch (err) {
      report(null, t("tools.keygen.cannotCopy", { error: String(err) }));
    }
  };

  const write = async (target: GeneratedKey, kind: SaveKind, path: string, replace: boolean) => {
    setOverwrite(null);
    setBusy(true);
    try {
      await saveKeyFile(kind, target.id, path, replace);
      report(t(SAVED[kind], { path }));
    } catch (err) {
      if (isKeygenError(err) && err.kind === "exists") {
        setOverwrite({ kind, path });
        report(null, t("tools.keygen.existsOverwrite", { path: err.path }));
      } else {
        report(null, describeKeygenError(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const defaultPath = (target: GeneratedKey, kind: SaveKind) => {
    const base = loadedPath ? loadedPath.replace(/\.ppk$/i, "") : defaultName(target.publicKey);
    if (kind === "public") return `${base}.pub`;
    if (kind === "ppk") return `${base}.ppk`;
    return loadedPath && !/\.ppk$/i.test(loadedPath) ? loadedPath : base;
  };

  const saveAs = async (kind: SaveKind) => {
    const target = await applyChanges();
    if (!target) return;
    const path = await save({ title: t(SAVE_TITLES[kind]), defaultPath: defaultPath(target, kind) });
    if (path) await write(target, kind, path, false);
  };

  const askPassword = (label: string) =>
    new Promise<PasswordAnswer | null>((resolve) => setAsking({ label, resolve }));

  const runInstall = async (session: SavedSession, target: SshTarget, trusted: string | null) => {
    const key = await applyChanges();
    if (!key) return;
    setBusy(true);
    report(t("tools.keygen.installing", { name: session.name }));
    try {
      const outcome = await installKey(key.id, target, trusted);
      report(
        outcome === "added"
          ? t("tools.keygen.installed", { name: session.name })
          : t("tools.keygen.alreadyInstalled", { name: session.name }),
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
    if (!session) return report(null, t("tools.keygen.chooseSession"));
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
          <h2 id="keygen-title">{t("tools.keygen.title")}</h2>
          <p className="muted">{t("tools.keygen.intro")}</p>
          <div className="form-row">
            <label className="field field--grow">
              {t("tools.keygen.type")}
              <select value={family} onChange={(e) => setFamily(e.target.value as Family)}>
                <option value="ed25519">Ed25519</option>
                <option value="rsa">RSA</option>
                <option value="ecdsa">ECDSA</option>
              </select>
            </label>
            {family !== "ed25519" && (
              <label className="field field--grow">
                {t("tools.keygen.size")}
                <select
                  value={family === "rsa" ? rsaBits : ecdsaBits}
                  onChange={(e) => (family === "rsa" ? setRsaBits : setEcdsaBits)(e.target.value)}
                >
                  {SIZES[family].map((bits) => (
                    <option key={bits} value={bits}>
                      {t("tools.keygen.bits", { bits })}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="form-row">
            <label className="field field--grow">
              {t("tools.keygen.passphrase")}
              <input
                type="password"
                autoFocus
                autoComplete="new-password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </label>
            <label className="field field--grow">
              {t("tools.keygen.confirmPassphrase")}
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
          </div>
          <label className="field">
            {t("tools.keygen.comment")}
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
              {key ? t("tools.keygen.generateAgain") : t("tools.keygen.generate")}
            </button>
            <button type="button" className="btn btn--icon" onClick={pickKeyFile} disabled={busy}>
              <FolderOpen size={14} aria-hidden />
              {t("tools.keygen.load")}
            </button>
          </div>

          {unlocking && (
            <div className="form-row keygen__install">
              <label className="field field--grow">
                {t("tools.keygen.passphraseOf", { name: baseName(unlocking) })}
                <input
                  type="password"
                  autoFocus
                  autoComplete="current-password"
                  value={unlockPassphrase}
                  onChange={(e) => setUnlockPassphrase(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void loadFrom(unlocking, unlockPassphrase);
                    }
                  }}
                />
              </label>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => loadFrom(unlocking, unlockPassphrase)}
                disabled={busy}
              >
                {t("tools.keygen.unlock")}
              </button>
              <button type="button" className="btn" onClick={() => (setUnlocking(null), setUnlockPassphrase(""), report(null))}>
                {t("common.cancel")}
              </button>
            </div>
          )}

          {key && (
            <>
              <label className="field">
                {t("tools.keygen.publicKey")}
                <textarea className="keygen__public" readOnly rows={3} value={key.publicKey} spellCheck={false} />
              </label>
              <p className="muted">
                <span className="keygen__type">{key.keyType}</span> {t("tools.keygen.fingerprint")}{" "}
                <code className="keygen__fingerprint">{key.fingerprint}</code>
              </p>
              <div className="keygen__row">
                <button type="button" className="btn btn--icon" onClick={copy}>
                  <Copy size={14} aria-hidden />
                  {t("common.copy")}
                </button>
                <button type="button" className="btn btn--icon" onClick={() => saveAs("public")} disabled={busy}>
                  <Save size={14} aria-hidden />
                  {t("tools.keygen.savePublic")}
                </button>
                <button type="button" className="btn btn--icon" onClick={() => saveAs("private")} disabled={busy}>
                  <Save size={14} aria-hidden />
                  {t("tools.keygen.savePrivate")}
                </button>
                <button type="button" className="btn btn--icon" onClick={() => saveAs("ppk")} disabled={busy}>
                  <Save size={14} aria-hidden />
                  {t("tools.keygen.savePpk")}
                </button>
                {dirty && (
                  <button type="button" className="btn btn--icon" onClick={apply} disabled={busy}>
                    <Check size={14} aria-hidden />
                    {t("tools.keygen.applyChanges")}
                  </button>
                )}
              </div>
              {overwrite && (
                <div className="keygen__row">
                  <button
                    type="button"
                    className="btn keygen__danger"
                    onClick={() => key && write(key, overwrite.kind, overwrite.path, true)}
                  >
                    {t("tools.keygen.overwrite")}
                  </button>
                  <button type="button" className="btn" onClick={() => (setOverwrite(null), report(null))}>
                    {t("tools.keygen.keepFile")}
                  </button>
                </div>
              )}
              {sessions.length > 0 && (
                <div className="form-row keygen__install">
                  <label className="field field--grow">
                    {t("tools.keygen.savedSession")}
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
                    {t("tools.keygen.install")}
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
              {t("common.close")}
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
          via={trust.via ? t("tools.keygen.viaJumpHost", { name: trust.via, hop: trust.hop ?? "" }) : undefined}
          onTrust={trustHost}
          onCancel={() => setTrust(null)}
        />
      )}
    </>
  );
}
