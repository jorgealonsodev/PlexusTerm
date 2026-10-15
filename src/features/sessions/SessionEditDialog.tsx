import { useState, type FormEvent } from "react";
import { SerialFields } from "../serial/SerialFields";
import { fieldSetter, SshFields } from "../ssh/SshFields";
import type { LibrarySession } from "./library";
import { formFromSession, parseSessionForm, type SessionForm } from "./sessionForm";

interface SessionEditDialogProps {
  /** Existing session to edit, or a draft (new id, preset folder) to create. */
  session: LibrarySession;
  isNew: boolean;
  folders: string[];
  onSave: (session: LibrarySession) => void;
  onCancel: () => void;
}

export function SessionEditDialog({ session, isNew, folders, onSave, onCancel }: SessionEditDialogProps) {
  const [form, setForm] = useState<SessionForm>(() => formFromSession(session));
  const [error, setError] = useState<string | null>(null);
  const set = fieldSetter(setForm);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = parseSessionForm(form, session.id);
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
          </select>
        </label>
        <div className="form-row">
          <label className="field field--grow">
            Name
            <input
              autoFocus
              value={form.name}
              onChange={set("name")}
              placeholder={form.kind === "serial" ? "Device path" : "user@host"}
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
        {form.kind === "serial" ? (
          <SerialFields form={form.serial} onChange={(serial) => setForm((f) => ({ ...f, serial }))} />
        ) : (
          <>
            <SshFields form={form} set={set} withSecrets={false} />
            {form.method === "password" && (
              <p className="muted">The password is asked each time you connect; it is never saved.</p>
            )}
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
