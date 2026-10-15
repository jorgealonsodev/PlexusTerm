import { useState } from "react";

export interface FindOptions {
  caseSensitive: boolean;
  regex: boolean;
}

export type FindDirection = "next" | "previous";

interface FindBarProps {
  /** Searches the scrollback; returns whether a match was found. */
  onFind: (text: string, options: FindOptions, direction: FindDirection) => boolean;
  onClose: () => void;
}

/** Search bar shown over the focused pane (S15.1). */
export function FindBar({ onFind, onClose }: FindBarProps) {
  const [text, setText] = useState("");
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
        aria-label="Find in terminal"
        placeholder="Find"
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
      {notFound && <span className="find-bar__status">No matches</span>}
      <label className="find-bar__option" title="Match case">
        <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
        Match case
      </label>
      <label className="find-bar__option" title="Regular expression">
        <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} />
        Regex
      </label>
      <button type="button" className="find-bar__btn" aria-label="Previous match" onClick={() => find("previous")}>
        ↑
      </button>
      <button type="button" className="find-bar__btn" aria-label="Next match" onClick={() => find("next")}>
        ↓
      </button>
      <button type="button" className="find-bar__btn" aria-label="Close find" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
