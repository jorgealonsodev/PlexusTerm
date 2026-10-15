import { useState, type FormEvent } from "react";
import { compareHosts, portScan } from "./scanBackend";
import { progressText, useScan } from "./useScan";
import "./scan.css";

type OpenPort = { host: string; port: number; service: string | null };

export const DEFAULT_PORTS = "21,22,23,25,53,80,110,143,443,445,3306,3389,5432,5900,8080";

/** Tools > Port scanner: TCP connect scan of a host or IPv4 range, open ports listed as found. */
export function PortScannerDialog({ onClose }: { onClose: () => void }) {
  const [targets, setTargets] = useState("");
  const [ports, setPorts] = useState(DEFAULT_PORTS);
  const [open, setOpen] = useState<OpenPort[]>([]);
  const scan = useScan((event) => {
    if (event.event === "open") setOpen((rows) => [...rows, event.data]);
  });
  const running = scan.phase === "running";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (running) return scan.stop();
    setOpen([]);
    // An emptied Ports field means the common ports, as the placeholder says.
    void scan.start(portScan(targets, ports.trim() || DEFAULT_PORTS));
  };

  const rows = [...open].sort((a, b) => compareHosts(a.host, b.host) || a.port - b.port);
  const found = `${open.length} open port${open.length === 1 ? "" : "s"}`;

  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <form className="dialog scan-dialog" role="dialog" onSubmit={submit} aria-labelledby="port-scan-title" noValidate>
        <h2 id="port-scan-title">Port scanner</h2>
        <div className="scan-dialog__inputs">
          <label className="field">
            Hosts
            <input
              autoFocus
              spellCheck={false}
              placeholder="192.168.1.10-20, 192.168.1.0/24 or a host name"
              value={targets}
              disabled={running}
              onChange={(e) => setTargets(e.target.value)}
            />
          </label>
          <label className="field">
            Ports
            <input
              spellCheck={false}
              placeholder="Empty: common ports"
              value={ports}
              disabled={running}
              onChange={(e) => setPorts(e.target.value)}
            />
          </label>
        </div>
        <p className="muted">TCP connect scan, no root needed. Only scan hosts you are allowed to.</p>
        {scan.error && <p className="form-error" role="alert">{scan.error}</p>}
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
