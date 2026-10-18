import { useEffect, useMemo, useState } from "react";
import { useT } from "../../i18n/i18n";

export interface LicensedPackage {
  ecosystem: "rust" | "npm" | string;
  name: string;
  version: string;
  /** The SPDX expression the package declares. */
  license: string;
  /** Its repository or registry page. */
  source: string;
  /** Indexes into `texts`. */
  texts: number[];
}

/** scripts/generate-licenses.py's output: the shipped libraries and their (shared) license texts. */
export interface LicensesData {
  packages: LicensedPackage[];
  texts: string[];
}

/** The generated list, loaded only when the dialog opens (it is about 1 MB). */
const loadGenerated = () => import("./licenses.generated.json").then((m) => m.default as LicensesData);

interface LicensesDialogProps {
  load?: () => Promise<LicensesData>;
  onClose: () => void;
  onOpenLink: (url: string) => void;
}

/** Settings → About → Open-source licenses: every library shipped in PlexusTerm and its license. */
export function LicensesDialog({ load = loadGenerated, onClose, onOpenLink }: LicensesDialogProps) {
  const t = useT();
  const [data, setData] = useState<LicensesData | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    load().then(
      (loaded) => live && setData(loaded),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
    // Loaded once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    if (!data) return [];
    return words ? data.packages.filter((p) => `${p.name} ${p.license}`.toLowerCase().includes(words)) : data.packages;
  }, [data, query]);

  return (
    <div
      className="overlay"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        // Only this dialog closes, not one it was opened from (Settings).
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="dialog licenses" role="dialog" aria-labelledby="licenses-title">
        <h2 id="licenses-title">{t("settings.about.licenses")}</h2>
        <p className="muted">{t("settings.about.licensesIntro")}</p>
        <input
          type="search"
          className="sidebar__search"
          aria-label={t("settings.about.licensesSearch")}
          placeholder={t("settings.about.licensesSearch")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        {failed && (
          <p className="form-error" role="alert">
            {t("settings.about.licensesFailed")}
          </p>
        )}
        {!data && !failed && <p className="muted">{t("settings.about.licensesLoading")}</p>}
        {data && (
          <>
            <p className="muted">{t("settings.about.licensesCount", { count: shown.length })}</p>
            <ul className="licenses__list" aria-label={t("settings.about.licensesList")}>
              {shown.map((p) => {
                const key = `${p.ecosystem}:${p.name}@${p.version}`;
                const expanded = open === key;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      className="licenses__row"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : key)}
                    >
                      <span className="licenses__name">
                        {p.name} {p.version}
                      </span>
                      <span className="licenses__license">{p.license}</span>
                    </button>
                    {expanded && (
                      <div className="licenses__detail">
                        <a
                          href={p.source}
                          onClick={(e) => {
                            e.preventDefault();
                            onOpenLink(p.source);
                          }}
                        >
                          {p.source}
                        </a>
                        {p.texts.map((index) => (
                          <pre key={index} className="licenses__text">
                            {data.texts[index]}
                          </pre>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <div className="dialog__actions">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
