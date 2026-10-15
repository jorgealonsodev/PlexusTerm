import { X } from "lucide-react";
import { useState } from "react";
import { useT } from "../../i18n/i18n";

/**
 * The top-right corner of a split pane: the × appears while the pointer is in it. Shown with
 * mouse events rather than CSS :hover, which WebKitGTK does not update over the terminal.
 */
export function PaneCloseButton({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [shown, setShown] = useState(false);
  return (
    <div className="pane__corner" onMouseEnter={() => setShown(true)} onMouseLeave={() => setShown(false)}>
      {shown && (
        <button
          className="pane__close"
          aria-label={t("app.pane.close")}
          title={t("app.pane.closeTitle", { shortcut: "Ctrl+Shift+W" })}
          // Keep the keyboard focus where it is.
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={onClose}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
