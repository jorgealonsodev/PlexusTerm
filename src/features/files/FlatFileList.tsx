import type { LiHTMLAttributes } from "react";
import type { SftpEntry } from "../sftp/sftpClient";
import { formatDate, formatSize } from "../sftp/format";

const ICONS: Record<SftpEntry["kind"], string> = { dir: "📁", file: "📄", symlink: "🔗" };

interface FlatFileListProps {
  entries: SftpEntry[];
  selected: string | null;
  onSelect: (entry: SftpEntry) => void;
  /** Double-click or Enter: enters a folder, opens a file (the list's own "open"). */
  onOpen: (entry: SftpEntry) => void;
  /** The list's own handlers for a row: context menu, drag, middle click. */
  rowProps: (entry: SftpEntry) => LiHTMLAttributes<HTMLLIElement>;
  details: boolean;
}

/** The plain list of a folder's entries, outside DEV mode (DEV mode shows a {@link FileTree}). */
export function FlatFileList({ entries, selected, onSelect, onOpen, rowProps, details }: FlatFileListProps) {
  return (
    <ul className="sftp__list">
      {entries.map((entry) => (
        <li
          key={entry.path}
          className={`sftp-row${entry.path === selected ? " sftp-row--selected" : ""}`}
          tabIndex={0}
          title={entry.path}
          onClick={() => onSelect(entry)}
          onDoubleClick={() => onOpen(entry)}
          onKeyDown={(e) => e.key === "Enter" && onOpen(entry)}
          {...rowProps(entry)}
        >
          <span className="sftp-row__icon">{ICONS[entry.kind]}</span>
          <span className="sftp-row__name">{entry.name}</span>
          {details && (
            <>
              <span className="sftp-row__size">{entry.kind === "dir" ? "" : formatSize(entry.size)}</span>
              <span className="sftp-row__date">{entry.modified ? formatDate(entry.modified) : ""}</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
