import { CircleHelp } from "lucide-react";
import { useId, useRef, useState } from "react";

/** Widest the explanation grows, in px. */
const MAX_WIDTH = 260;

/**
 * A round "?" that explains a panel while the pointer is over it or it has the keyboard focus.
 * The explanation is placed in the viewport (fixed), so the scrolling sidebar never clips it.
 */
export function HelpTip({ text }: { text: string }) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const show = () => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const left = Math.max(8, Math.min(box.left, window.innerWidth - MAX_WIDTH - 8));
    setAt({ left, top: box.bottom + 6 });
  };
  const hide = () => setAt(null);
  return (
    <span
      ref={ref}
      className="help-tip"
      tabIndex={0}
      role="button"
      aria-label={text}
      aria-describedby={at ? id : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(e) => e.key === "Escape" && hide()}
    >
      <CircleHelp size={14} aria-hidden="true" />
      {at && (
        <span id={id} role="tooltip" className="help-tip__text" style={{ left: at.left, top: at.top, maxWidth: MAX_WIDTH }}>
          {text}
        </span>
      )}
    </span>
  );
}
