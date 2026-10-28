import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useT } from "../../i18n/i18n";
import { FIND_ALL_LIMIT, type FindResult } from "./findAll";

/** The pause in typing before the terminals are searched. */
export const FIND_ALL_DEBOUNCE_MS = 150;
/** A match further into its line than this is shown with the start of the line cut off. */
const LEAD_SHOWN = 40;

interface FindAllDialogProps {
  /** Searches every terminal for `query` (plain text). */
  search: (query: string, matchCase: boolean) => { results: FindResult[]; capped: boolean };
  /** Closes the dialog; `chosen` is the result to jump to, if one was chosen. */
  onClose: (chosen?: FindResult) => void;
}

/** The line of a result with its match marked, its start cut off when the match is far into it. */
function MatchLine({ result }: { result: FindResult }) {
  const from = result.index > LEAD_SHOWN ? result.index - LEAD_SHOWN / 2 : 0;
  const end = result.index + result.length;
  return (
    <span className="find-all__line" dir="auto">
      {from > 0 && "…"}
      {result.line.slice(from, result.index)}
      <mark>{result.line.slice(result.index, end)}</mark>
      {result.line.slice(end)}
    </span>
  );
}

/**
 * Find in all tabs (S3): the text is searched in the buffer of every terminal, scrollback included,
 * as it is typed; ↑/↓ choose a result, Enter or a click jumps to it, Esc closes.
 */
export function FindAllDialog({ search, onClose }: FindAllDialogProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [found, setFound] = useState<{ query: string; results: FindResult[]; capped: boolean }>({ query: "", results: [], capped: false });
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef(search);
  searchRef.current = search;

  useEffect(() => {
    const timer = setTimeout(() => {
      setFound({ query, ...searchRef.current(query, matchCase) });
      setSelected(0);
    }, FIND_ALL_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, matchCase]);

  const { results, capped } = found;
  const current = Math.min(selected, Math.max(0, results.length - 1));

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [current]);

  /** The results tab by tab (they come in tab order), each tab saying whether it has several panes. */
  const groups = useMemo(() => {
    const byTab: { tabKey: string; tabTitle: string; items: { result: FindResult; index: number }[]; panes: Set<string> }[] = [];
    results.forEach((result, index) => {
      let group = byTab[byTab.length - 1];
      if (group?.tabKey !== result.tabKey) byTab.push((group = { tabKey: result.tabKey, tabTitle: result.tabTitle, items: [], panes: new Set() }));
      group.items.push({ result, index });
      group.panes.add(result.paneId);
    });
    return byTab;
  }, [results]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setSelected((current + step + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const result = results[current];
      if (result) onClose(result);
    }
  };

  return (
    <div className="overlay overlay--top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette find-all" role="dialog" aria-label={t("app.findAll.title")}>
        <div className="find-all__bar">
          <input
            className="palette__input find-all__input"
            role="combobox"
            aria-expanded="true"
            aria-controls="find-all-list"
            aria-activedescendant={results[current] ? `find-all-item-${current}` : undefined}
            autoFocus
            spellCheck={false}
            placeholder={t("app.findAll.placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <label className="find-all__case">
            <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />
            {t("app.findAll.matchCase")}
          </label>
        </div>
        <ul className="palette__list" id="find-all-list" role="listbox" ref={listRef}>
          {groups.map((group) => (
            <li key={group.tabKey} role="group" aria-label={group.tabTitle} className="find-all__group">
              <div className="find-all__tab" aria-hidden="true">
                {group.tabTitle}
              </div>
              <ul className="find-all__items" role="presentation">
                {group.items.map(({ result, index }) => (
                  <li
                    key={index}
                    id={`find-all-item-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={index === current}
                    className={index === current ? "palette__item palette__item--selected" : "palette__item"}
                    onMouseMove={() => index !== current && setSelected(index)}
                    onClick={() => onClose(result)}
                  >
                    <MatchLine result={result} />
                    {group.panes.size > 1 && <span className="palette__group">{result.paneTitle}</span>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {found.query !== "" && results.length === 0 && <p className="palette__empty muted">{t("app.findAll.noResults")}</p>}
        {capped && <p className="palette__empty muted">{t("app.findAll.capped", { limit: FIND_ALL_LIMIT })}</p>}
      </div>
    </div>
  );
}
