import { useState, type FormEvent } from "react";
import { compareHosts, portScan } from "./scanBackend";
import { progressText, useScan } from "./useScan";
import { DEFAULT_PORT_CHOICE, DEFAULT_PORTS, portsFor, type PortMode } from "./portChoice";
import "./scan.css";

type OpenPort = { host: string; port: number; service: string | null };

/** Tools > Port scanner: TCP connect scan of a host or IPv4 range, open ports listed as found. */
export function PortScannerDialog({ onClose }: { onClose: () => void }) {
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
  const found = `${open.length} open port${open.length === 1 ? "" : "s"}`;

  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <form className="dialog scan-dialog" role="dialog" onSubmit={submit} aria-labelledby="port-scan-title" noValidate>
        <h2 id="port-scan-title">Port scanner</h2>
        <label className="field">
          Hosts
          <input
            autoFocus
            spellCheck={false}
            placeholder="192.168.1.10, 192.168.1.10-20, 192.168.1.0/24 or a host name"
            value={targets}
            disabled={running}
            onChange={(e) => setTargets(e.target.value)}
          />
        </label>
        <fieldset className="port-choice" disabled={running}>
          <legend>Ports</legend>
          <label className="check">
            <input type="radio" name="port-mode" checked={choice.mode === "known"} onChange={() => mode("known")} />
            Known ports
          </label>
          <div className="port-choice__row">
            <label className="check">
              <input type="radio" name="port-mode" checked={choice.mode === "range"} onChange={() => mode("range")} />
              Port range
            </label>
            <input
              className="port-choice__number"
              aria-label="First port"
              inputMode="numeric"
              maxLength={5}
              disabled={choice.mode !== "range"}
              value={choice.from}
              onChange={(e) => setChoice({ ...choice, from: e.target.value.replace(/\D/g, "") })}
            />
            <span className="ip-range__sep">→</span>
            <input
              className="port-choice__number"
              aria-label="Last port"
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
              Custom list
            </label>
            <input
              className="port-choice__list"
              aria-label="Custom ports"
              spellCheck={false}
              placeholder="Empty: known ports"
              disabled={choice.mode !== "custom"}
              value={choice.list}
              onChange={(e) => setChoice({ ...choice, list: e.target.value })}
            />
          </div>
        </fieldset>
        <p className="muted" title={DEFAULT_PORTS}>Known ports: FTP, SSH, Telnet, SMTP, DNS, HTTP, POP3, IMAP, HTTPS, SMB, MySQL, RDP, PostgreSQL, VNC, 8080. TCP connect scan, no root needed. Only scan hosts you are allowed to.</p>
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
                <th scope="col">Host</th>
                <th scope="col">Port</th>
                <th scope="col">State</th>
                <th scope="col">Service</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.host}:${row.port}`}>
                  <td>{row.host}</td>
                  <td>{row.port}</td>
                  <td className="scan-table__open">open</td>
                  <td>{row.service ?? ""}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted scan-table__empty">
                    {running ? "No open ports yet." : "No results."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="submit" className="btn btn--primary">
            {running ? "Stop" : "Start"}
          </button>
        </div>
      </form>
    </div>
  );
}
