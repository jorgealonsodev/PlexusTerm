import type { TelnetForm } from "./telnetForm";

interface TelnetFieldsProps {
  form: TelnetForm;
  onChange: (form: TelnetForm) => void;
  autoFocusHost?: boolean;
}

export function TelnetFields({ form, onChange, autoFocusHost = false }: TelnetFieldsProps) {
  return (
    <>
      <div className="form-row">
        <label className="field field--grow">
          Host
          <input
            autoFocus={autoFocusHost}
            value={form.host}
            onChange={(e) => onChange({ ...form, host: e.target.value })}
            placeholder="host or address"
          />
        </label>
        <label className="field field--port">
          Port
          <input value={form.port} onChange={(e) => onChange({ ...form, port: e.target.value })} placeholder="23" />
        </label>
      </div>
      <p className="muted">Telnet is not encrypted: everything typed, passwords included, travels in clear text.</p>
    </>
  );
}
