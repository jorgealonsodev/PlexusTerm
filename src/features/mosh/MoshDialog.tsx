import { useState, type FormEvent } from "react";
import type { SavedSession } from "../sessions/library";
import { MoshFields } from "./MoshFields";
import type { MoshForm } from "./mosh";

interface MoshDialogProps {
  /** Saved SSH sessions Mosh can log in with. */
  sessions: SavedSession[];
  /** `serverCommand` is undefined for the default command. */
  onConnect: (sshSessionId: string, serverCommand: string | undefined) => void;
  onCancel: () => void;
}

export function MoshDialog({ sessions, onConnect, onCancel }: MoshDialogProps) {
  const [form, setForm] = useState<MoshForm>({ sshSessionId: sessions[0]?.id ?? "", serverCommand: "" });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.sshSessionId) return;
    onConnect(form.sshSessionId, form.serverCommand.trim() || undefined);
  };

  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <form className="dialog" onSubmit={submit} aria-labelledby="mosh-title">
        <h2 id="mosh-title">Mosh session</h2>
        <MoshFields form={form} onChange={setForm} sessions={sessions} />
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={!form.sshSessionId}>
            Connect
          </button>
        </div>
      </form>
    </div>
  );
}
