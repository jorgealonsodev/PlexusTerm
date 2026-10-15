import { invoke } from "@tauri-apps/api/core";
import { useState, type FormEvent } from "react";
import { emptyWolForm, parseWolForm } from "./wolForm";

/** Tools > Wake On LAN: sends the magic packet that powers on a machine of the local network. */
export function WakeOnLanDialog({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState(emptyWolForm);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSent(null);
    const result = parseWolForm(form);
    if (!result.ok) return setError(result.error);
    setError(null);
    setSending(true);
    try {
      await invoke("wol_send", { mac: result.mac, broadcast: result.broadcast, port: result.port });
      setSent(`Magic packet sent to ${result.mac}.`);
    } catch (err) {
      setError(String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <form className="dialog" role="dialog" onSubmit={submit} aria-labelledby="wol-title" noValidate>
        <h2 id="wol-title">Wake On LAN</h2>
        <label className="field">
          MAC address
          <input
            autoFocus
            spellCheck={false}
            placeholder="aa:bb:cc:dd:ee:ff"
            value={form.mac}
            onChange={(e) => setForm({ ...form, mac: e.target.value })}
          />
        </label>
        <label className="field">
          Broadcast address
          <input
            spellCheck={false}
            placeholder="255.255.255.255"
            value={form.broadcast}
            onChange={(e) => setForm({ ...form, broadcast: e.target.value })}
          />
        </label>
        <label className="field field--port">
          Port
          <input placeholder="9" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
        </label>
        <p className="muted">The machine must have Wake On LAN enabled and be on this network (or reachable through the broadcast address).</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        {sent && <p role="status">{sent}</p>}
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="submit" className="btn btn--primary" disabled={sending}>
            Wake
          </button>
        </div>
      </form>
    </div>
  );
}
