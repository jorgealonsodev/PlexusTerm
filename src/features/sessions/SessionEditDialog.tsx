import { useEffect, useState, type FormEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { MoshFields } from "../mosh/MoshFields";
import { ShellPicker } from "../terminal/ShellPicker";
import { usePlatform } from "../platform/usePlatform";
import { SerialFields } from "../serial/SerialFields";
import { TelnetFields } from "../telnet/TelnetFields";
import { checkSetter, fieldSetter, SshFields } from "../ssh/SshFields";
import { JumpHostsField } from "./JumpHostsField";
import { isSshSession, type LibrarySession, type SavedSession } from "./library";
import { secretDelete, secretExists } from "./secrets";
import { formFromSession, parseSessionForm, type SessionForm } from "./sessionForm";
import { t, useT } from "../../i18n/i18n";

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

const namePlaceholder = (kind: SessionForm["kind"]): string =>
  ({
    ssh: "user@host",
    serial: t("sessions.edit.devicePath"),
    telnet: t("common.host"),
    mosh: t("sessions.edit.moshNamePlaceholder"),
    local: t("sessions.target.local"),
  })[kind];

export function SessionEditDialog({
  session,
  isNew,
  folders,
  jumpCandidates = [],
  onSave,
  onCancel,
}: SessionEditDialogProps) {
  const t = useT();
  const [form, setForm] = useState<SessionForm>(() => formFromSession(session));
  const [error, setError] = useState<string | null>(null);
  const set = fieldSetter(setForm);
  const [hasSecret, setHasSecret] = useState(false);
  const [secretNote, setSecretNote] = useState<string | null>(null);
  // Mosh has no Windows client; an existing Mosh session keeps its type so it stays editable.
  const offerMosh = usePlatform() !== "windows" || formFromSession(session).kind === "mosh";

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
        setSecretNote(t("sessions.edit.passwordForgotten"));
      })
      .catch((err: unknown) => {
        const message = (err as { message?: unknown } | null)?.message;
        setSecretNote(
          t("sessions.edit.forgetFailed", { error: typeof message === "string" ? message : String(err) }),
        );
      });
  };

  const browseStartDir = async () => {
    try {
      const dir = await open({ title: t("sessions.edit.chooseStartDir"), multiple: false, directory: true });
      if (typeof dir === "string") setForm((f) => ({ ...f, local: { ...f.local, cwd: dir } }));
    } catch {
      // No folder picker (e.g. outside Tauri): the field can still be typed.
    }
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
        <h2 id="se-title">{isNew ? t("sessions.edit.newTitle") : t("sessions.edit.editTitle")}</h2>
        <label className="field">
          {t("sessions.edit.type")}
          <select value={form.kind} onChange={set("kind")}>
            <option value="ssh">SSH</option>
            <option value="serial">{t("sessions.edit.serial")}</option>
            <option value="telnet">Telnet</option>
            {offerMosh && <option value="mosh">Mosh</option>}
            <option value="local">{t("sessions.edit.local")}</option>
          </select>
        </label>
        <div className="form-row">
          <label className="field field--grow">
            {t("common.name")}
            <input
              autoFocus
              value={form.name}
              onChange={set("name")}
              placeholder={namePlaceholder(form.kind)}
            />
          </label>
          <label className="field field--grow">
            {t("sessions.edit.folder")}
            <input value={form.folder} onChange={set("folder")} list="session-folders" placeholder={t("sessions.edit.folderPlaceholder")} />
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
        {form.kind === "local" && (
          <>
            <ShellPicker
              id="session-local-shell"
              label={t("sessions.edit.shell")}
              program={form.local.program}
              args={form.local.args}
              onChange={(program, args) => setForm((f) => ({ ...f, local: { ...f.local, program, args } }))}
            />
            <div className="field">
              <label htmlFor="session-start-dir">{t("sessions.edit.startDir")}</label>
              <div className="form-row field__picker">
                <input
                  id="session-start-dir"
                  value={form.local.cwd}
                  placeholder={t("sessions.edit.startDirPlaceholder")}
                  spellCheck={false}
                  onChange={(e) => {
                    const cwd = e.target.value;
                    setForm((f) => ({ ...f, local: { ...f.local, cwd } }));
                  }}
                />
                <button type="button" className="btn" onClick={() => void browseStartDir()}>
                  {t("common.browse")}
                </button>
              </div>
            </div>
          </>
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
            <SshFields form={form} set={set} check={checkSetter(setForm)} withSecrets={false} />
            {form.method === "password" && (
              <p className="muted">
                {t("sessions.edit.passwordNote")}
              </p>
            )}
            {hasSecret && (
              <button type="button" className="btn" onClick={forgetSecret}>
                {t("sessions.edit.forgetPassword")}
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
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn btn--primary">
            {t("common.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
