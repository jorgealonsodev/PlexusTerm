import { useState, type ChangeEvent, type FormEvent } from "react";
import type { SavedSession } from "../sessions/library";
import { useT } from "../../i18n/i18n";
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
  const t = useT();
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
        <h2 id="te-title">{isNew ? t("tunnels.edit.newTitle") : t("tunnels.edit.editTitle")}</h2>
        <div className="form-row">
          <label className="field field--grow">
            {t("common.name")}
            <input autoFocus value={form.name} onChange={set("name")} placeholder={t("tunnels.edit.namePlaceholder")} />
          </label>
          <label className="field">
            {t("tunnels.edit.type")}
            <select value={form.type} onChange={set("type")}>
              {tunnelTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {t(type.label)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          {t("tunnels.edit.sshSession")}
          <select value={form.sessionId} onChange={set("sessionId")}>
            <option value="">{t("tunnels.edit.chooseSession")}</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.username}@{s.host})
              </option>
            ))}
          </select>
        </label>
        {sessions.length === 0 && <p className="muted">{t("tunnels.edit.noSessions")}</p>}
        <div className="form-row">
          <label className="field field--grow">
            {remote ? t("tunnels.edit.listenAddressServer") : t("tunnels.edit.listenAddress")}
            <input value={form.listenHost} onChange={set("listenHost")} placeholder="127.0.0.1" />
          </label>
          <label className="field field--port">
            {t("common.port")}
            <input value={form.listenPort} onChange={set("listenPort")} inputMode="numeric" />
          </label>
        </div>
        {exposed && (
          <p className="form-error" role="alert">
            {t(remote ? "tunnels.edit.exposedRemote" : "tunnels.edit.exposedLocal", { host: form.listenHost.trim() })}
          </p>
        )}
        {form.type !== "dynamic" && (
          <div className="form-row">
            <label className="field field--grow">
              {remote ? t("tunnels.edit.destinationFromHere") : t("tunnels.edit.destinationFromServer")}
              <input value={form.destHost} onChange={set("destHost")} placeholder="localhost" />
            </label>
            <label className="field field--port">
              {t("common.port")}
              <input value={form.destPort} onChange={set("destPort")} inputMode="numeric" />
            </label>
          </div>
        )}
        {form.type === "dynamic" && (
          <p className="muted">{t("tunnels.edit.dynamicHint")}</p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
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
