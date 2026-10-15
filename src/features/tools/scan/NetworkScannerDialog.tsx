import { useState, type FormEvent } from "react";
import { compareHosts, NETWORK_SERVICES, networkScan } from "./scanBackend";
import { progressText, useScan } from "./useScan";
import "./scan.css";

type LiveHost = { host: string; name: string | null; mac: string | null; ports: number[] };

type Props = { onClose: () => void; onNewSshSession: (host: string) => void };

/** Tools > Network scanner: live hosts of an IPv4 range or CIDR, found by probing common service ports. */
export function NetworkScannerDialog({ onClose, onNewSshSession }: Props) {
  const [targets, setTargets] = useState("");
  const [hosts, setHosts] = useState<LiveHost[]>([]);
  const scan = useScan((event) => {
    if (event.event === "host") setHosts((rows) => [...rows, event.data]);
  });
  const running = scan.phase === "running";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (running) return scan.stop();
    setHosts([]);
    void scan.start(networkScan(targets));
  };

  const rows = [...hosts].sort((a, b) => compareHosts(a.host, b.host));
  const found = `${hosts.length} live host${hosts.length === 1 ? "" : "s"}`;

  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <form className="dialog scan-dialog" role="dialog" onSubmit={submit} aria-labelledby="network-scan-title" noValidate>
        <h2 id="network-scan-title">Network scanner</h2>
        <label className="field">
          Network
          <input
            autoFocus
            spellCheck={false}
            placeholder="192.168.1.0/24 or 192.168.1.1-254"
            value={targets}
            disabled={running}
            onChange={(e) => setTargets(e.target.value)}
          />
        </label>
        <p className="muted">
          Finds hosts by probing {NETWORK_SERVICES.map(([, label]) => label).join(", ")} over TCP (no root, no ping). Only
          scan networks you are allowed to.
        </p>
        {scan.error && <p className="form-error" role="alert">{scan.error}</p>}
        <p role="status" className="scan-dialog__status">{progressText(scan.phase, scan.progress, found)}</p>
        <div className="scan-results">
          <table className="scan-table">
            <thead>
              <tr>
                <th scope="col">Host</th>
                <th scope="col">Name</th>
                <th scope="col">MAC</th>
                <th scope="col">Services</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.host}>
                  <td>{row.host}</td>
                  <td>{row.name ?? ""}</td>
                  <td className="scan-table__mono">{row.mac ?? ""}</td>
                  <td>
                    <span className="scan-services">
                      {NETWORK_SERVICES.filter(([port]) => row.ports.includes(port)).map(([port, label]) => (
                        <span key={port} className="scan-badge">
                          {label}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td>
                    {row.ports.includes(22) && (
                      <button
                        type="button"
                        className="btn scan-table__action"
                        aria-label={`New SSH session to ${row.host}`}
                        onClick={() => onNewSshSession(row.host)}
                      >
                        New SSH session
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted scan-table__empty">
                    {running ? "No live hosts yet." : "No results."}
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
