import { useState } from "react";
import { Pipette } from "lucide-react";
import { useT } from "../../i18n/i18n";
import { highestContrastOn } from "../settings/uiTheme";

const VALID = /^#[0-9a-f]{6}$/i;

interface CustomColorDialogProps {
  /** The colour in use, the dialog's starting point. */
  initial: string | null;
  /** Picks a colour anywhere on the screen (null when cancelled); null where the system has no picker. */
  pickFromScreen: (() => Promise<string | null>) | null;
  onAccept: (color: string) => void;
  onCancel: () => void;
}

/**
 * Any colour: typed as `#rrggbb`, chosen in the system's colour picker or picked from anywhere on
 * the screen. Accept is painted with the colour, so the choice shows before it is made.
 */
export function CustomColorDialog({ initial, pickFromScreen, onAccept, onCancel }: CustomColorDialogProps) {
  const t = useT();
  const [code, setCode] = useState(initial ?? "#2e86de");
  const [pickError, setPickError] = useState<string | null>(null);
  const color = VALID.test(code.trim()) ? code.trim().toLowerCase() : null;
  const pick = () => {
    setPickError(null);
    void pickFromScreen?.()
      .then((picked) => picked && VALID.test(picked) && setCode(picked.toLowerCase()))
      .catch((err) => setPickError(typeof err === "string" ? err : err instanceof Error ? err.message : String(err)));
  };
  return (
    <div
      className="overlay"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onCancel();
      }}
    >
      <form
        className="dialog custom-color"
        role="dialog"
        aria-labelledby="custom-color-title"
        onSubmit={(e) => {
          e.preventDefault();
          if (color) onAccept(color);
        }}
      >
        <h2 id="custom-color-title">{t("app.toolbarColor.customTitle")}</h2>
        <div className="custom-color__row">
          <input
            type="color"
            className="custom-color__picker"
            aria-label={t("app.toolbarColor.choose")}
            title={t("app.toolbarColor.choose")}
            value={color ?? "#000000"}
            onChange={(e) => setCode(e.target.value.toLowerCase())}
          />
          <input
            type="text"
            className="custom-color__code"
            aria-label={t("app.toolbarColor.code")}
            spellCheck={false}
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />
          {pickFromScreen && (
            <button type="button" className="btn btn--icon" title={t("app.toolbarColor.fromScreen")} aria-label={t("app.toolbarColor.fromScreen")} onClick={pick}>
              <Pipette size={15} aria-hidden="true" />
            </button>
          )}
        </div>
        {pickError && (
          <p className="form-error" role="alert">
            {pickError}
          </p>
        )}
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            className="btn custom-color__accept"
            disabled={!color}
            style={color ? { background: color, color: highestContrastOn(color), borderColor: color } : undefined}
          >
            {t("app.toolbarColor.accept")}
          </button>
        </div>
      </form>
    </div>
  );
}
