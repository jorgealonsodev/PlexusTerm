import type { TelnetForm } from "./telnetForm";
import { useT } from "../../i18n/i18n";

interface TelnetFieldsProps {
  form: TelnetForm;
  onChange: (form: TelnetForm) => void;
  autoFocusHost?: boolean;
}

export function TelnetFields({ form, onChange, autoFocusHost = false }: TelnetFieldsProps) {
  const t = useT();
  return (
    <>
      <div className="form-row">
        <label className="field field--grow">
          {t("common.host")}
          <input
            autoFocus={autoFocusHost}
            value={form.host}
            onChange={(e) => onChange({ ...form, host: e.target.value })}
            placeholder={t("sessions.telnet.hostPlaceholder")}
          />
        </label>
        <label className="field field--port">
          {t("common.port")}
          <input value={form.port} onChange={(e) => onChange({ ...form, port: e.target.value })} placeholder="23" />
        </label>
      </div>
      <p className="muted">{t("sessions.telnet.unencrypted")}</p>
    </>
  );
}
