import type { SavedSession } from "../sessions/library";
import { DEFAULT_SERVER_COMMAND, type MoshForm } from "./mosh";
import { useT } from "../../i18n/i18n";

interface MoshFieldsProps {
  form: MoshForm;
  onChange: (form: MoshForm) => void;
  /** Saved SSH sessions Mosh can log in with. */
  sessions: SavedSession[];
}

export function MoshFields({ form, onChange, sessions }: MoshFieldsProps) {
  const t = useT();
  if (sessions.length === 0) {
    return <p className="muted">{t("sessions.mosh.needsSsh")}</p>;
  }
  const missing = form.sshSessionId !== "" && !sessions.some((s) => s.id === form.sshSessionId);
  return (
    <>
      <label className="field">
        {t("sessions.mosh.sshSession")}
        <select value={form.sshSessionId} onChange={(e) => onChange({ ...form, sshSessionId: e.target.value })}>
          {form.sshSessionId === "" && <option value="">{t("sessions.mosh.choose")}</option>}
          {missing && <option value={form.sshSessionId}>{t("sessions.jumps.deleted")}</option>}
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {`${s.name} — ${s.username}@${s.host}`}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        {t("sessions.mosh.serverCommand")}
        <input
          value={form.serverCommand}
          onChange={(e) => onChange({ ...form, serverCommand: e.target.value })}
          placeholder={DEFAULT_SERVER_COMMAND}
        />
      </label>
      <p className="muted">{t("sessions.mosh.requirements")}</p>
    </>
  );
}
