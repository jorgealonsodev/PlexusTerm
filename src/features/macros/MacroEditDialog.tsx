import { useState, type FormEvent } from "react";
import { formFromMacro, moveRow, newRow, parseMacroForm, type MacroForm, type StepRow } from "./macroForm";
import { HOTKEYS, hotkeyLabel, type Macro, type StepKind } from "./macros";

interface MacroEditDialogProps {
  /** Existing macro to edit, or a draft (new id) to create. */
  macro: Macro;
  isNew: boolean;
  /** Every saved macro, to show who uses each hotkey. */
  macros: Macro[];
  onSave: (macro: Macro) => void;
  onCancel: () => void;
}

const KINDS: { value: StepKind; label: string }[] = [
  { value: "send", label: "Send text" },
  { value: "wait", label: "Wait" },
  { value: "waitFor", label: "Wait for text" },
];

/** Edits a macro's name, hotkey and steps (S16.4). */
export function MacroEditDialog({ macro, isNew, macros, onSave, onCancel }: MacroEditDialogProps) {
  const [form, setForm] = useState<MacroForm>(() => formFromMacro(macro));
  const [error, setError] = useState<string | null>(null);

  const setRows = (update: (rows: StepRow[]) => StepRow[]) => setForm((prev) => ({ ...prev, rows: update(prev.rows) }));
  const patchRow = (key: string, patch: Partial<StepRow>) =>
    setRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = parseMacroForm(form, macro.id);
    if (result.ok) onSave(result.macro);
    else setError(result.error);
  };

  const owner = (hotkey: number) => macros.find((m) => m.hotkey === hotkey && m.id !== macro.id);

  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <form className="dialog dialog--wide" onSubmit={submit} aria-labelledby="me-title">
        <h2 id="me-title">{isNew ? "New macro" : "Edit macro"}</h2>
        <div className="form-row">
          <label className="field field--grow">
            Name
            <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="field">
            Hotkey
            <select value={form.hotkey} onChange={(e) => setForm({ ...form, hotkey: e.target.value })}>
              <option value="">None</option>
              {HOTKEYS.map((n) => {
                const used = owner(n);
                return (
                  <option key={n} value={String(n)}>
                    {used ? `${hotkeyLabel(n)} (${used.name})` : hotkeyLabel(n)}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
        <p className="muted">
          Escapes in text: \r Enter, \n, \t, \e Escape, \\, \xHH, ^C and other ^A–^Z control keys, ^[ and ^?.
        </p>
        <ol className="macro-steps">
          {form.rows.map((row, i) => {
            const n = i + 1;
            return (
              <li key={row.key} className="macro-step">
                <select
                  aria-label={`Step ${n} kind`}
                  value={row.kind}
                  onChange={(e) => patchRow(row.key, { kind: e.target.value as StepKind })}
                >
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
                {row.kind === "wait" ? (
                  <input
                    className="macro-step__number"
                    aria-label={`Step ${n} milliseconds`}
                    inputMode="numeric"
                    value={row.ms}
                    onChange={(e) => patchRow(row.key, { ms: e.target.value })}
                  />
                ) : (
                  <input
                    className="macro-step__text"
                    aria-label={`Step ${n} text`}
                    placeholder={row.kind === "send" ? "e.g. ls -la\\r" : "e.g. password:"}
                    value={row.text}
                    onChange={(e) => patchRow(row.key, { text: e.target.value })}
                  />
                )}
                {row.kind === "wait" && <span className="muted">ms</span>}
                {row.kind === "waitFor" && (
                  <>
                    <input
                      className="macro-step__number"
                      aria-label={`Step ${n} timeout in seconds`}
                      inputMode="numeric"
                      value={row.timeoutSec}
                      onChange={(e) => patchRow(row.key, { timeoutSec: e.target.value })}
                    />
                    <span className="muted">s</span>
                  </>
                )}
                <span className="macro-step__actions">
                  <button
                    type="button"
                    aria-label={`Move step ${n} up`}
                    disabled={i === 0}
                    onClick={() => setRows((rows) => moveRow(rows, i, -1))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move step ${n} down`}
                    disabled={i === form.rows.length - 1}
                    onClick={() => setRows((rows) => moveRow(rows, i, 1))}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove step ${n}`}
                    onClick={() => setRows((rows) => rows.filter((r) => r.key !== row.key))}
                  >
                    ✕
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
        {form.rows.length === 0 && <p className="muted">No steps yet.</p>}
        <div>
          <button type="button" className="btn btn--small" onClick={() => setRows((rows) => [...rows, newRow()])}>
            Add step
          </button>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
