import { useState } from "react";
import { useT } from "../../i18n/i18n";

export interface FindOptions {
  caseSensitive: boolean;
  regex: boolean;
}

export type FindDirection = "next" | "previous";

interface FindBarProps {
  /** Searches the scrollback; returns whether a match was found. */
  onFind: (text: string, options: FindOptions, direction: FindDirection) => boolean;
  onClose: () => void;
  /** Text the bar opens with (e.g. the selection it was opened from). */
  initialText?: string;
}

/** Search bar shown over the focused pane (S15.1). */
export function FindBar({ onFind, onClose, initialText = "" }: FindBarProps) {
  const t = useT();
  const [text, setText] = useState(initialText);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const find = (direction: FindDirection) => {
    if (text === "") return;
    setNotFound(!onFind(text, { caseSensitive, regex }, direction));
  };

  return (
    <div className="find-bar" role="search">
      <input
        autoFocus
        aria-label={t("terminal.find.label")}
        placeholder={t("terminal.find.placeholder")}
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          setNotFound(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "Enter") {
            e.preventDefault();
            find(e.shiftKey ? "previous" : "next");
          }
        }}
      />
      {notFound && <span className="find-bar__status">{t("terminal.find.noMatches")}</span>}
      <label className="find-bar__option" title={t("terminal.find.matchCase")}>
        <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
        {t("terminal.find.matchCase")}
      </label>
      <label className="find-bar__option" title={t("terminal.find.regexTitle")}>
        <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} />
        {t("terminal.find.regex")}
      </label>
      <button type="button" className="find-bar__btn" aria-label={t("terminal.find.previous")} onClick={() => find("previous")}>
        ↑
      </button>
      <button type="button" className="find-bar__btn" aria-label={t("terminal.find.next")} onClick={() => find("next")}>
        ↓
      </button>
      <button type="button" className="find-bar__btn" aria-label={t("terminal.find.close")} onClick={onClose}>
        ×
      </button>
    </div>
  );
}
