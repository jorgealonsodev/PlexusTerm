import type { SavedSession } from "../sessions/library";
import { DEFAULT_SERVER_COMMAND, type MoshForm } from "./mosh";

interface MoshFieldsProps {
  form: MoshForm;
  onChange: (form: MoshForm) => void;
  /** Saved SSH sessions Mosh can log in with. */
  sessions: SavedSession[];
}

export function MoshFields({ form, onChange, sessions }: MoshFieldsProps) {
  if (sessions.length === 0) {
    return <p className="muted">Mosh logs in with a saved SSH session: save one first.</p>;
  }
  const missing = form.sshSessionId !== "" && !sessions.some((s) => s.id === form.sshSessionId);
  return (
    <>
      <label className="field">
        SSH session
        <select value={form.sshSessionId} onChange={(e) => onChange({ ...form, sshSessionId: e.target.value })}>
          {form.sshSessionId === "" && <option value="">Choose a saved SSH session</option>}
          {missing && <option value={form.sshSessionId}>(deleted session)</option>}
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {`${s.name} — ${s.username}@${s.host}`}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Server command
        <input
          value={form.serverCommand}
          onChange={(e) => onChange({ ...form, serverCommand: e.target.value })}
          placeholder={DEFAULT_SERVER_COMMAND}
        />
      </label>
      <p className="muted">
        Needs mosh on both machines and UDP ports 60000-61000 open to the server.
      </p>
    </>
  );
}
