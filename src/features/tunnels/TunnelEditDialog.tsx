import { useState, type ChangeEvent, type FormEvent } from "react";
import type { SavedSession } from "../sessions/library";
import { formFromTunnel, parseTunnelForm, type TunnelForm } from "./tunnelForm";
import { isLoopback, tunnelTypes, type Tunnel } from "./tunnels";

interface TunnelEditDialogProps {
  /** Existing tunnel to edit, or a draft (new id) to create. */
  tunnel: Tunnel;
  isNew: boolean;
  sessions: SavedSession[];
  onSave: (tunnel: Tunnel) => void;
  onCancel: () => void;
}

export function TunnelEditDialog({ tunnel, isNew, sessions, onSave, onCancel }: TunnelEditDialogProps) {
  const [form, setForm] = useState<TunnelForm>(() => formFromTunnel(tunnel));
  const [error, setError] = useState<string | null>(null);
  const set =
    (key: keyof TunnelForm) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = parseTunnelForm(
      form,
      tunnel.id,
      sessions.map((s) => s.id),
    );
    if (result.ok) onSave(result.tunnel);
    else setError(result.error);
  };

  const exposed = form.listenHost.trim() !== "" && !isLoopback(form.listenHost);
  const remote = form.type === "remote";

  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <form className="dialog" onSubmit={submit} aria-labelledby="te-title">
        <h2 id="te-title">{isNew ? "New SSH tunnel" : "Edit tunnel"}</h2>
        <div className="form-row">
          <label className="field field--grow">
            Name
            <input autoFocus value={form.name} onChange={set("name")} placeholder="Generated from the ports" />
          </label>
          <label className="field">
            Type
            <select value={form.type} onChange={set("type")}>
              {tunnelTypes.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          SSH session
          <select value={form.sessionId} onChange={set("sessionId")}>
            <option value="">Choose a saved session…</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.username}@{s.host})
              </option>
            ))}
          </select>
        </label>
        {sessions.length === 0 && <p className="muted">Save an SSH session first; tunnels use its connection.</p>}
        <div className="form-row">
          <label className="field field--grow">
            {remote ? "Listen address on the server" : "Listen address"}
            <input value={form.listenHost} onChange={set("listenHost")} placeholder="127.0.0.1" />
          </label>
          <label className="field field--port">
            Port
            <input value={form.listenPort} onChange={set("listenPort")} inputMode="numeric" />
          </label>
        </div>
        {exposed && (
          <p className="form-error" role="alert">
            Listening on {form.listenHost.trim()} lets other machines {remote ? "reach the server port" : "use this tunnel"}.
            Use 127.0.0.1 to keep it private.
          </p>
        )}
        {form.type !== "dynamic" && (
          <div className="form-row">
            <label className="field field--grow">
              {remote ? "Destination (from this machine)" : "Destination (from the server)"}
              <input value={form.destHost} onChange={set("destHost")} placeholder="localhost" />
            </label>
            <label className="field field--port">
              Port
              <input value={form.destPort} onChange={set("destPort")} inputMode="numeric" />
            </label>
          </div>
        )}
        {form.type === "dynamic" && (
          <p className="muted">Applications use this port as a SOCKS5 proxy; the server opens the connections.</p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
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
