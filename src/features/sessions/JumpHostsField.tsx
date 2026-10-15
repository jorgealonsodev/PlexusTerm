import { useState } from "react";
import { MAX_JUMPS, type SavedSession } from "./library";
import { useT } from "../../i18n/i18n";

interface JumpHostsFieldProps {
  /** Ids of the chosen jump hosts, outermost first. */
  value: string[];
  onChange: (ids: string[]) => void;
  /** Saved SSH sessions that can be chosen (the edited session excluded). */
  candidates: SavedSession[];
}

/** Ordered list of jump hosts (S14.1): add from the saved SSH sessions, remove, move up/down. */
export function JumpHostsField({ value, onChange, candidates }: JumpHostsFieldProps) {
  const t = useT();
  const [choice, setChoice] = useState("");
  const nameOf = (id: string) => candidates.find((c) => c.id === id)?.name ?? t("sessions.jumps.deleted");
  const available = candidates.filter((c) => !value.includes(c.id));
  const full = value.length >= MAX_JUMPS;
  const selected = available.some((c) => c.id === choice) ? choice : (available[0]?.id ?? "");

  const move = (index: number, by: -1 | 1) => {
    const next = [...value];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    onChange(next);
  };

  return (
    <fieldset className="jump-hosts">
      <legend>{t("sessions.jumps.legend")}</legend>
      {value.length === 0 ? (
        <p className="muted">{t("sessions.jumps.direct")}</p>
      ) : (
        <ol className="jump-hosts__list">
          {value.map((id, index) => {
            const name = nameOf(id);
            return (
              <li key={id} className="jump-hosts__item">
                <span className="jump-hosts__name">{name}</span>
                <button
                  type="button"
                  className="btn btn--small"
                  aria-label={t("sessions.jumps.moveUp", { name })}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn--small"
                  aria-label={t("sessions.jumps.moveDown", { name })}
                  disabled={index === value.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn--small"
                  aria-label={t("sessions.jumps.remove", { name })}
                  onClick={() => onChange(value.filter((_, i) => i !== index))}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <div className="form-row">
        <label className="field field--grow">
          {t("sessions.jumps.addLabel")}
          <select
            value={selected}
            disabled={full || available.length === 0}
            onChange={(e) => setChoice(e.target.value)}
          >
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn jump-hosts__add"
          disabled={full || !selected}
          onClick={() => {
            onChange([...value, selected]);
            setChoice("");
          }}
        >
          {t("common.add")}
        </button>
      </div>
      {full && <p className="muted">{t("sessions.jumps.max", { max: MAX_JUMPS })}</p>}
    </fieldset>
  );
}
