import { useState, type FormEvent } from "react";
import { compareHosts, portScan } from "./scanBackend";
import { progressText, useScan } from "./useScan";
import { useT } from "../../../i18n/i18n";
import { DEFAULT_PORT_CHOICE, DEFAULT_PORTS, portsFor, type PortMode } from "./portChoice";
import "./scan.css";

type OpenPort = { host: string; port: number; service: string | null };

/** Tools > Port scanner: TCP connect scan of a host or IPv4 range, open ports listed as found. */
export function PortScannerDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [targets, setTargets] = useState("");
  const [choice, setChoice] = useState(DEFAULT_PORT_CHOICE);
  const [inputError, setInputError] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenPort[]>([]);
  const scan = useScan((event) => {
    if (event.event === "open") setOpen((rows) => [...rows, event.data]);
  });
  const running = scan.phase === "running";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (running) return scan.stop();
    const ports = portsFor(choice);
    if (!ports.ok) return setInputError(ports.error);
    setInputError(null);
    setOpen([]);
    void scan.start(portScan(targets, ports.ports));
  };

  const mode = (next: PortMode) => setChoice({ ...choice, mode: next });

  const rows = [...open].sort((a, b) => compareHosts(a.host, b.host) || a.port - b.port);
  const found = t("tools.portScan.openPorts", { count: open.length });

  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <form className="dialog scan-dialog" role="dialog" onSubmit={submit} aria-labelledby="port-scan-title" noValidate>
        <h2 id="port-scan-title">{t("tools.portScan.title")}</h2>
        <label className="field">
          {t("tools.portScan.hosts")}
          <input
            autoFocus
            spellCheck={false}
            placeholder={t("tools.portScan.hostsPlaceholder")}
            value={targets}
            disabled={running}
            onChange={(e) => setTargets(e.target.value)}
          />
        </label>
        <fieldset className="port-choice" disabled={running}>
          <legend>{t("tools.portScan.ports")}</legend>
          <label className="check">
            <input type="radio" name="port-mode" checked={choice.mode === "known"} onChange={() => mode("known")} />
            {t("tools.portScan.knownPorts")}
          </label>
          <div className="port-choice__row">
            <label className="check">
              <input type="radio" name="port-mode" checked={choice.mode === "range"} onChange={() => mode("range")} />
              {t("tools.portScan.portRange")}
            </label>
            <input
              className="port-choice__number"
              aria-label={t("tools.portScan.firstPort")}
              inputMode="numeric"
              maxLength={5}
              disabled={choice.mode !== "range"}
              value={choice.from}
              onChange={(e) => setChoice({ ...choice, from: e.target.value.replace(/\D/g, "") })}
            />
            <span className="ip-range__sep">→</span>
            <input
              className="port-choice__number"
              aria-label={t("tools.portScan.lastPort")}
              inputMode="numeric"
              maxLength={5}
              disabled={choice.mode !== "range"}
              value={choice.to}
              onChange={(e) => setChoice({ ...choice, to: e.target.value.replace(/\D/g, "") })}
            />
          </div>
          <div className="port-choice__row">
            <label className="check">
              <input type="radio" name="port-mode" checked={choice.mode === "custom"} onChange={() => mode("custom")} />
              {t("tools.portScan.customList")}
            </label>
            <input
              className="port-choice__list"
              aria-label={t("tools.portScan.customPorts")}
              spellCheck={false}
              placeholder={t("tools.portScan.customPlaceholder")}
              disabled={choice.mode !== "custom"}
              value={choice.list}
              onChange={(e) => setChoice({ ...choice, list: e.target.value })}
            />
          </div>
        </fieldset>
        <p className="muted" title={DEFAULT_PORTS}>
          {t("tools.portScan.hint")}
        </p>
        {(inputError ?? scan.error) && (
          <p className="form-error" role="alert">
            {inputError ?? scan.error}
          </p>
        )}
        <p role="status" className="scan-dialog__status">{progressText(scan.phase, scan.progress, found)}</p>
        <div className="scan-results">
          <table className="scan-table">
            <thead>
              <tr>
                <th scope="col">{t("tools.scan.host")}</th>
                <th scope="col">{t("common.port")}</th>
                <th scope="col">{t("tools.portScan.state")}</th>
                <th scope="col">{t("tools.scan.service")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.host}:${row.port}`}>
                  <td>{row.host}</td>
                  <td>{row.port}</td>
                  <td className="scan-table__open">{t("tools.portScan.open")}</td>
                  <td>{row.service ?? ""}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted scan-table__empty">
                    {running ? t("tools.portScan.noPortsYet") : t("tools.scan.noResults")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("common.close")}
          </button>
          <button type="submit" className="btn btn--primary">
            {running ? t("common.stop") : t("common.start")}
          </button>
        </div>
      </form>
    </div>
  );
}
