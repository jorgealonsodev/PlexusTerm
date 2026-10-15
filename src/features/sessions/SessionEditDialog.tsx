import { useEffect, useState, type FormEvent } from "react";
import { MoshFields } from "../mosh/MoshFields";
import { SerialFields } from "../serial/SerialFields";
import { TelnetFields } from "../telnet/TelnetFields";
import { fieldSetter, SshFields } from "../ssh/SshFields";
import { JumpHostsField } from "./JumpHostsField";
import { isSshSession, type LibrarySession, type SavedSession } from "./library";
import { secretDelete, secretExists } from "./secrets";
import { formFromSession, parseSessionForm, type SessionForm } from "./sessionForm";

interface SessionEditDialogProps {
  /** Existing session to edit, or a draft (new id, preset folder) to create. */
  session: LibrarySession;
  isNew: boolean;
  folders: string[];
  /** Saved SSH sessions that can be used as jump hosts or as the login of a Mosh session. */
  jumpCandidates?: SavedSession[];
  onSave: (session: LibrarySession) => void;
  onCancel: () => void;
}

const NAME_PLACEHOLDERS: Record<SessionForm["kind"], string> = {
  ssh: "user@host",
  serial: "Device path",
  telnet: "Host",
  mosh: "SSH session (mosh)",
};

export function SessionEditDialog({
  session,
  isNew,
  folders,
  jumpCandidates = [],
  onSave,
  onCancel,
}: SessionEditDialogProps) {
  const [form, setForm] = useState<SessionForm>(() => formFromSession(session));
  const [error, setError] = useState<string | null>(null);
  const set = fieldSetter(setForm);
  const [hasSecret, setHasSecret] = useState(false);
  const [secretNote, setSecretNote] = useState<string | null>(null);

  // Only existing SSH sessions can have a password saved in the keyring.
  useEffect(() => {
    if (isNew || !isSshSession(session)) return;
    let live = true;
    void secretExists(session.id).then((exists) => live && setHasSecret(exists));
    return () => {
      live = false;
    };
  }, [isNew, session]);

  const forgetSecret = () => {
    secretDelete(session.id)
      .then(() => {
        setHasSecret(false);
        setSecretNote("Saved password forgotten.");
      })
      .catch((err: unknown) => {
        const message = (err as { message?: unknown } | null)?.message;
        setSecretNote(`Could not forget the saved password: ${typeof message === "string" ? message : String(err)}`);
      });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = parseSessionForm(form, session.id, { sessions: jumpCandidates ?? [] });
    if (result.ok) onSave(result.session);
    else setError(result.error);
  };

  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <form className="dialog" onSubmit={submit} aria-labelledby="se-title">
        <h2 id="se-title">{isNew ? "New session" : "Edit session"}</h2>
        <label className="field">
          Session type
          <select value={form.kind} onChange={set("kind")}>
            <option value="ssh">SSH</option>
            <option value="serial">Serial</option>
            <option value="telnet">Telnet</option>
            <option value="mosh">Mosh</option>
          </select>
        </label>
        <div className="form-row">
          <label className="field field--grow">
            Name
            <input
              autoFocus
              value={form.name}
              onChange={set("name")}
              placeholder={NAME_PLACEHOLDERS[form.kind]}
            />
          </label>
          <label className="field field--grow">
            Folder
            <input value={form.folder} onChange={set("folder")} list="session-folders" placeholder="Root" />
            <datalist id="session-folders">
              {folders.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </label>
        </div>
        {form.kind === "serial" && (
          <SerialFields form={form.serial} onChange={(serial) => setForm((f) => ({ ...f, serial }))} />
        )}
        {form.kind === "telnet" && (
          <TelnetFields form={form.telnet} onChange={(telnet) => setForm((f) => ({ ...f, telnet }))} />
        )}
        {form.kind === "mosh" && (
          <MoshFields
            form={form.mosh}
            onChange={(mosh) => setForm((f) => ({ ...f, mosh }))}
            sessions={jumpCandidates.filter((c) => c.id !== session.id)}
          />
        )}
        {form.kind === "ssh" && (
          <>
            <SshFields form={form} set={set} withSecrets={false} />
            {form.method === "password" && (
              <p className="muted">
                The password is asked when you connect; the prompt can save it in the system keyring.
              </p>
            )}
            {hasSecret && (
              <button type="button" className="btn" onClick={forgetSecret}>
                Forget saved password
              </button>
            )}
            {secretNote && <p className="muted" role="status">{secretNote}</p>}
            <JumpHostsField
              value={form.jumpIds ?? []}
              onChange={(jumpIds) => setForm((f) => ({ ...f, jumpIds }))}
              candidates={jumpCandidates.filter((c) => c.id !== session.id)}
            />
          </>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
