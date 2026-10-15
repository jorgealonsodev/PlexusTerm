import { useCallback, useEffect, useState } from "react";
import { listSerialPorts } from "./serialBackend";
import { COMMON_BAUD_RATES, CUSTOM_BAUD, type SerialForm } from "./serialSettings";

interface SerialFieldsProps {
  form: SerialForm;
  onChange: (form: SerialForm) => void;
  autoFocusPath?: boolean;
}

/** Device picker (detected ports + free text) and line settings, shared by quick connect and saved sessions. */
export function SerialFields({ form, onChange, autoFocusPath }: SerialFieldsProps) {
  const [ports, setPorts] = useState<string[] | null>(null);
  const [portsError, setPortsError] = useState<string | null>(null);
  const set =
    (field: keyof SerialForm) =>
    (e: { target: { value: string } }) =>
      onChange({ ...form, [field]: e.target.value });

  const refresh = useCallback(() => {
    setPortsError(null);
    listSerialPorts()
      .then(setPorts)
      .catch((err) => {
        setPorts([]);
        setPortsError(String(err));
      });
  }, []);
  useEffect(refresh, [refresh]);

  return (
    <>
      <div className="serial-ports">
        <div className="serial-ports__header">
          <span>Detected ports</span>
          <button type="button" className="btn" onClick={refresh}>
            Refresh
          </button>
        </div>
        {ports === null ? (
          <p className="muted">Looking for serial ports...</p>
        ) : ports.length === 0 ? (
          <p className="muted">{portsError ?? "No serial ports detected."}</p>
        ) : (
          <div className="serial-ports__list">
            {ports.map((port) => (
              <button
                key={port}
                type="button"
                className={`serial-port${port === form.path ? " serial-port--selected" : ""}`}
                onClick={() => onChange({ ...form, path: port })}
              >
                {port}
              </button>
            ))}
          </div>
        )}
      </div>
      <label className="field">
        Serial port
        <input autoFocus={autoFocusPath} value={form.path} onChange={set("path")} placeholder="/dev/ttyUSB0" />
      </label>
      <div className="form-row">
        <label className="field field--grow">
          Baud rate
          <select value={form.baud} onChange={set("baud")}>
            {COMMON_BAUD_RATES.map((rate) => (
              <option key={rate} value={String(rate)}>
                {rate}
              </option>
            ))}
            <option value={CUSTOM_BAUD}>Custom...</option>
          </select>
        </label>
        {form.baud === CUSTOM_BAUD && (
          <label className="field field--grow">
            Custom baud rate
            <input value={form.customBaud} onChange={set("customBaud")} inputMode="numeric" />
          </label>
        )}
      </div>
      <div className="form-row">
        <label className="field field--grow">
          Data bits
          <select value={form.dataBits} onChange={set("dataBits")}>
            {["5", "6", "7", "8"].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="field field--grow">
          Parity
          <select value={form.parity} onChange={set("parity")}>
            <option value="none">None</option>
            <option value="odd">Odd</option>
            <option value="even">Even</option>
          </select>
        </label>
        <label className="field field--grow">
          Stop bits
          <select value={form.stopBits} onChange={set("stopBits")}>
            <option value="1">1</option>
            <option value="2">2</option>
          </select>
        </label>
        <label className="field field--grow">
          Flow control
          <select value={form.flow} onChange={set("flow")}>
            <option value="none">None</option>
            <option value="software">XON/XOFF</option>
            <option value="hardware">RTS/CTS</option>
          </select>
        </label>
      </div>
    </>
  );
}
