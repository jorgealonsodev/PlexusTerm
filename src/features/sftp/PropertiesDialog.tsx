import "./sftp.css";
import { formatSize } from "./format";
import { modeString, octalString } from "./permissions";
import type { SftpEntry } from "./sftpClient";

const KINDS: Record<SftpEntry["kind"], string> = { dir: "Folder", file: "File", symlink: "Symbolic link" };

/** "name (id)", whichever parts the server reported. */
function owner(name: string | null, id: number | null): string {
  if (name !== null && id !== null) return `${name} (${id})`;
  return name ?? (id !== null ? String(id) : "Unknown");
}

/** Read-only details of one remote entry. */
export function PropertiesDialog({ entry, onClose }: { entry: SftpEntry; onClose: () => void }) {
  const rows: [string, string][] = [
    ["Name", entry.name],
    ["Path", entry.path],
    ["Type", KINDS[entry.kind]],
    ["Size", entry.kind === "dir" ? "—" : `${formatSize(entry.size)} (${entry.size} bytes)`],
    ["Modified", entry.modified ? new Date(entry.modified * 1000).toLocaleString() : "Unknown"],
    ["Owner", owner(entry.user, entry.uid)],
    ["Group", owner(entry.group, entry.gid)],
    [
      "Permissions",
      entry.permissions === null ? "Unknown" : `${modeString(entry.permissions)} (${octalString(entry.permissions)})`,
    ],
  ];
  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="dialog" role="dialog" aria-labelledby="sftp-properties-title">
        <h2 id="sftp-properties-title">Properties</h2>
        <dl className="sftp-properties">
          {rows.map(([label, value]) => (
            <div key={label} className="sftp-properties__row">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="dialog__actions">
          <button type="button" className="btn btn--primary" autoFocus onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
