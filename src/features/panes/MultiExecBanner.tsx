interface MultiExecBannerProps {
  /** Terminals that receive what is typed in the focused pane, the focused one included. */
  count: number;
  onTurnOff: () => void;
}

/** Shown while multi-execution is on so it is never left on by accident (S11.4). */
export function MultiExecBanner({ count, onTurnOff }: MultiExecBannerProps) {
  return (
    <div className="multiexec-banner" role="status">
      <span>
        Multi-execution ON — input goes to {count} {count === 1 ? "terminal" : "terminals"}
      </span>
      <button className="btn" onClick={onTurnOff}>
        Turn off
      </button>
    </div>
  );
}
