import { useT } from "../../i18n/i18n";
import { formatSize } from "../sftp/format";
import { folderOf, type ZmodemView } from "./zmodem";
import "./zmodem.css";

interface ZmodemBarProps {
  view: ZmodemView;
  /** Declines the offer or stops the transfer. */
  onCancel: () => void;
  /** Hides a finished transfer's result. */
  onClose: () => void;
}

/** A ZMODEM transfer of the pane (`sz`/`rz` on the remote): what goes, how far, and Cancel. */
export function ZmodemBar({ view, onCancel, onClose }: ZmodemBarProps) {
  const t = useT();
  const working = view.kind === "asking" || view.kind === "running";
  let text: string;
  let percent: number | null = null;
  switch (view.kind) {
    case "asking":
      text = t(view.direction === "receive" ? "terminal.zmodem.askingFolder" : "terminal.zmodem.askingFiles");
      break;
    case "running": {
      const done = formatSize(view.bytes);
      const amount =
        view.total === null ? done : t("terminal.zmodem.amount", { done, total: formatSize(view.total) });
      const verb = view.direction === "receive" ? "terminal.zmodem.receiving" : "terminal.zmodem.sending";
      text = `${t(verb, { file: view.file })} · ${amount}`;
      if (view.total) percent = Math.min(100, Math.round((view.bytes / view.total) * 100));
      else if (view.total === 0) percent = 100;
      break;
    }
    case "done":
      text =
        view.direction === "receive"
          ? t("terminal.zmodem.received", { count: view.files.length, folder: folderOf(view.files[0] ?? "") })
          : t("terminal.zmodem.sent", { count: view.files.length });
      break;
    case "cancelled":
      text = t("terminal.zmodem.cancelled");
      break;
    case "failed":
      text = t("terminal.zmodem.failed", { message: view.message });
      break;
  }
  const title = view.kind === "done" ? view.files.join("\n") : undefined;
  return (
    <div className={`zmodem-bar${view.kind === "failed" ? " zmodem-bar--failed" : ""}`} role="status">
      <span className="zmodem-bar__text" title={title}>
        {text}
      </span>
      {percent !== null && (
        <progress className="zmodem-bar__progress" max={100} value={percent} aria-label={`${percent} %`} />
      )}
      {working ? (
        <button type="button" className="zmodem-bar__btn" onClick={onCancel}>
          {t("terminal.zmodem.cancel")}
        </button>
      ) : (
        <button type="button" className="zmodem-bar__btn" onClick={onClose}>
          {t("terminal.zmodem.close")}
        </button>
      )}
    </div>
  );
}
