import { useCallback, useEffect, useState } from "react";
import { usePlatform } from "../platform/usePlatform";
import { listSerialPorts } from "./serialBackend";
import { COMMON_BAUD_RATES, CUSTOM_BAUD, type SerialForm } from "./serialSettings";
import { useT } from "../../i18n/i18n";

interface SerialFieldsProps {
  form: SerialForm;
  onChange: (form: SerialForm) => void;
  autoFocusPath?: boolean;
}

/** Device picker (detected ports + free text) and line settings, shared by quick connect and saved sessions. */
export function SerialFields({ form, onChange, autoFocusPath }: SerialFieldsProps) {
  const [ports, setPorts] = useState<string[] | null>(null);
  const [portsError, setPortsError] = useState<string | null>(null);
  const platform = usePlatform();
  const t = useT();
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
          <span>{t("sessions.serial.detected")}</span>
          <button type="button" className="btn" onClick={refresh}>
            {t("common.refresh")}
          </button>
        </div>
        {ports === null ? (
          <p className="muted">{t("sessions.serial.looking")}</p>
        ) : ports.length === 0 ? (
          <p className="muted">{portsError ?? t("sessions.serial.noneDetected")}</p>
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
        {t("sessions.serial.port")}
        <input autoFocus={autoFocusPath} value={form.path} onChange={set("path")} placeholder={platform === "windows" ? "COM3" : "/dev/ttyUSB0"} />
      </label>
      <div className="form-row">
        <label className="field field--grow">
          {t("sessions.serial.baud")}
          <select value={form.baud} onChange={set("baud")}>
            {COMMON_BAUD_RATES.map((rate) => (
              <option key={rate} value={String(rate)}>
                {rate}
              </option>
            ))}
            <option value={CUSTOM_BAUD}>{t("sessions.serial.custom")}</option>
          </select>
        </label>
        {form.baud === CUSTOM_BAUD && (
          <label className="field field--grow">
            {t("sessions.serial.customBaud")}
            <input value={form.customBaud} onChange={set("customBaud")} inputMode="numeric" />
          </label>
        )}
      </div>
      <div className="form-row">
        <label className="field field--grow">
          {t("sessions.serial.dataBits")}
          <select value={form.dataBits} onChange={set("dataBits")}>
            {["5", "6", "7", "8"].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="field field--grow">
          {t("sessions.serial.parity")}
          <select value={form.parity} onChange={set("parity")}>
            <option value="none">{t("sessions.serial.none")}</option>
            <option value="odd">{t("sessions.serial.odd")}</option>
            <option value="even">{t("sessions.serial.even")}</option>
          </select>
        </label>
        <label className="field field--grow">
          {t("sessions.serial.stopBits")}
          <select value={form.stopBits} onChange={set("stopBits")}>
            <option value="1">1</option>
            <option value="2">2</option>
          </select>
        </label>
        <label className="field field--grow">
          {t("sessions.serial.flow")}
          <select value={form.flow} onChange={set("flow")}>
            <option value="none">{t("sessions.serial.none")}</option>
            <option value="software">XON/XOFF</option>
            <option value="hardware">RTS/CTS</option>
          </select>
        </label>
      </div>
    </>
  );
}
