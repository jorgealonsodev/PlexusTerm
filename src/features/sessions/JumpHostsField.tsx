import { useState } from "react";
import { MAX_JUMPS, type SavedSession } from "./library";

interface JumpHostsFieldProps {
  /** Ids of the chosen jump hosts, outermost first. */
  value: string[];
  onChange: (ids: string[]) => void;
  /** Saved SSH sessions that can be chosen (the edited session excluded). */
  candidates: SavedSession[];
}

const DELETED = "(deleted session)";

/** Ordered list of jump hosts (S14.1): add from the saved SSH sessions, remove, move up/down. */
export function JumpHostsField({ value, onChange, candidates }: JumpHostsFieldProps) {
  const [choice, setChoice] = useState("");
  const nameOf = (id: string) => candidates.find((c) => c.id === id)?.name ?? DELETED;
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
      <legend>Jump hosts</legend>
      {value.length === 0 ? (
        <p className="muted">Connects directly. Add saved SSH sessions to go through them first, in order.</p>
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
                  aria-label={`Move ${name} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn--small"
                  aria-label={`Move ${name} down`}
                  disabled={index === value.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn--small"
                  aria-label={`Remove ${name}`}
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
          Add jump host
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
          Add
        </button>
      </div>
      {full && <p className="muted">At most {MAX_JUMPS} jump hosts.</p>}
    </fieldset>
  );
}
