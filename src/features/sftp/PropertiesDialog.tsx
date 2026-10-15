import "./sftp.css";
import { t, useT } from "../../i18n/i18n";
import type { AppKey } from "../../i18n/catalogs";
import { formatSize } from "./format";
import { modeString, octalString } from "./permissions";
import type { SftpEntry } from "./sftpClient";

const KINDS: Record<SftpEntry["kind"], AppKey> = {
  dir: "sftp.properties.folder",
  file: "sftp.properties.file",
  symlink: "sftp.properties.symlink",
};

/** "name (id)", whichever parts the server reported. */
function owner(name: string | null, id: number | null): string {
  if (name !== null && id !== null) return `${name} (${id})`;
  return name ?? (id !== null ? String(id) : t("sftp.properties.unknown"));
}

/** Read-only details of one remote entry. */
export function PropertiesDialog({ entry, onClose }: { entry: SftpEntry; onClose: () => void }) {
  const t = useT();
  const unknown = t("sftp.properties.unknown");
  const rows: [string, string][] = [
    [t("common.name"), entry.name],
    [t("sftp.properties.path"), entry.path],
    [t("sftp.properties.type"), t(KINDS[entry.kind])],
    [
      t("sftp.properties.size"),
      entry.kind === "dir" ? "—" : t("sftp.properties.sizeValue", { size: formatSize(entry.size), bytes: entry.size }),
    ],
    [t("sftp.properties.modified"), entry.modified ? new Date(entry.modified * 1000).toLocaleString() : unknown],
    [t("sftp.properties.owner"), owner(entry.user, entry.uid)],
    [t("sftp.properties.group"), owner(entry.group, entry.gid)],
    [
      t("sftp.properties.permissions"),
      entry.permissions === null ? unknown : `${modeString(entry.permissions)} (${octalString(entry.permissions)})`,
    ],
  ];
  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="dialog" role="dialog" aria-labelledby="sftp-properties-title">
        <h2 id="sftp-properties-title">{t("sftp.properties.title")}</h2>
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
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
