import { useT } from "../../i18n/i18n";

interface MultiExecBannerProps {
  /** Terminals that receive what is typed in the focused pane, the focused one included. */
  count: number;
  onTurnOff: () => void;
}

/** Shown while multi-execution is on so it is never left on by accident (S11.4). */
export function MultiExecBanner({ count, onTurnOff }: MultiExecBannerProps) {
  const t = useT();
  return (
    <div className="multiexec-banner" role="status">
      <span>{t("app.multiExec.banner", { count })}</span>
      <button className="btn" onClick={onTurnOff}>
        {t("app.multiExec.turnOff")}
      </button>
    </div>
  );
}
