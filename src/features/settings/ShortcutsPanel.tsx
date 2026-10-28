import { useState, type KeyboardEvent } from "react";
import { useT } from "../../i18n/i18n";
import {
  SHORTCUT_ACTION_IDS,
  SHORTCUT_ACTIONS,
  bindingsOf,
  shortcutConflict,
  type ShortcutActionId,
  type ShortcutConflict,
  type ShortcutGroup,
  type ShortcutOverrides,
} from "../panes/shortcuts";
import { DEFAULT_ASSISTANT_SHORTCUT } from "./settings";
import { isValidShortcut, shortcutFromEvent } from "./shortcutCapture";
import { HelpTip } from "../sidebar/HelpTip";

interface ShortcutsPanelProps {
  /** The user's changes only (see `TerminalSettings.shortcuts`). */
  overrides: ShortcutOverrides;
  assistantShortcut: string;
  onChange: (overrides: ShortcutOverrides) => void;
  onAssistantChange: (shortcut: string) => void;
  /** The drop-down window's system-wide shortcut ("" when it has none): no action may take it. */
  dropDownShortcut?: string;
}

const GROUPS: ShortcutGroup[] = ["tabs", "connections", "terminal", "font", "sidebar", "tools", "ai"];

/** Keys PlexusTerm keeps for itself, shown for reference. */
const FIXED_KEYS = [
  { keys: "Ctrl+Alt+1–9", label: "playMacro" },
  { keys: "→ / End", label: "acceptSuggestion" },
  { keys: "Ctrl+→", label: "acceptWord" },
] as const;

/**
 * Press a key combination to set it; Escape cancels. `onCapture` answers an error to show, or
 * null when the combination was taken.
 */
function ShortcutCapture({
  id,
  value,
  onCapture,
}: {
  id: string;
  value: string;
  onCapture: (shortcut: string) => string | null;
}) {
  const t = useT();
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!capturing) return;
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
    if (plain && e.key === "Tab") return; // keep moving through the form
    e.preventDefault();
    e.stopPropagation();
    if (plain && e.key === "Escape") {
      setCapturing(false);
      setError(null);
      return;
    }
    const shortcut = shortcutFromEvent(e);
    if (shortcut === null) return;
    const refused = isValidShortcut(shortcut) ? onCapture(shortcut) : t("settings.shortcuts.invalid");
    setError(refused);
    if (refused === null) setCapturing(false);
  };

  return (
    <>
      <input
        id={id}
        className={capturing ? "shortcut-capture shortcut-capture--active" : "shortcut-capture"}
        readOnly
        value={value}
        placeholder={t("settings.shortcuts.notSet")}
        onFocus={() => setCapturing(true)}
        onClick={() => setCapturing(true)}
        onBlur={() => {
          setCapturing(false);
          setError(null);
        }}
        onKeyDown={onKeyDown}
      />
      {capturing && !error && <span className="muted shortcuts__note">{t("settings.shortcuts.capturing")}</span>}
      {error && <span className="form-error shortcuts__note">{error}</span>}
    </>
  );
}

/** Every application shortcut, customisable, grouped as Settings shows them; then the fixed keys. */
export function ShortcutsPanel({ overrides, assistantShortcut, onChange, onAssistantChange, dropDownShortcut = "" }: ShortcutsPanelProps) {
  const t = useT();
  /** A refused reset, shown under its row. */
  const [resetError, setResetError] = useState<{ row: string; message: string } | null>(null);
  const actionName = (action: ShortcutActionId) => t(`settings.shortcuts.actions.${action}`);
  const assistantName = t("settings.shortcuts.actions.assistant");

  const describe = (shortcut: string, conflict: ShortcutConflict) =>
    t("settings.shortcuts.taken", {
      shortcut,
      action:
        conflict.kind === "action"
          ? actionName(conflict.action)
          : conflict.kind === "assistant"
            ? assistantName
            : t(`settings.shortcuts.fixed.${conflict.use === "playMacro" ? "playMacro" : "acceptWord"}`),
    });

  /** Why `shortcut` cannot be bound: the drop-down window's, or another use (null when it is free). */
  const refusal = (shortcut: string, options?: { action: ShortcutActionId; assistantShortcut: string }) => {
    if (dropDownShortcut && shortcut === dropDownShortcut) {
      return t("settings.shortcuts.taken", { shortcut, action: t("settings.groups.dropDown") });
    }
    const conflict = shortcutConflict(shortcut, overrides, options);
    return conflict ? describe(shortcut, conflict) : null;
  };

  /** Sets an action's override; matching its defaults exactly removes it (and "" for an unbound default). */
  const bind = (action: ShortcutActionId, shortcut: string) => {
    const defaults = SHORTCUT_ACTIONS[action].defaults;
    const { [action]: _old, ...rest } = overrides;
    const same = shortcut === "" ? defaults.length === 0 : defaults.length === 1 && defaults[0] === shortcut;
    onChange(same ? rest : { ...rest, [action]: shortcut });
  };

  const captureFor = (action: ShortcutActionId) => (shortcut: string) => {
    const refused = refusal(shortcut, { action, assistantShortcut });
    if (refused) return refused;
    setResetError(null);
    bind(action, shortcut);
    return null;
  };

  const captureAssistant = (shortcut: string) => {
    const refused = refusal(shortcut);
    if (refused) return refused;
    setResetError(null);
    onAssistantChange(shortcut);
    return null;
  };

  const reset = (action: ShortcutActionId) => {
    for (const shortcut of SHORTCUT_ACTIONS[action].defaults) {
      const refused = refusal(shortcut, { action, assistantShortcut });
      if (refused) return setResetError({ row: action, message: refused });
    }
    setResetError(null);
    const { [action]: _old, ...rest } = overrides;
    onChange(rest);
  };

  const resetAssistant = () => {
    const refused = refusal(DEFAULT_ASSISTANT_SHORTCUT);
    if (refused) return setResetError({ row: "assistant", message: refused });
    setResetError(null);
    onAssistantChange(DEFAULT_ASSISTANT_SHORTCUT);
  };

  const restoreAll = () => {
    setResetError(null);
    onChange({});
    onAssistantChange(DEFAULT_ASSISTANT_SHORTCUT);
  };

  const row = (
    key: string,
    name: string,
    value: string,
    onCapture: (shortcut: string) => string | null,
    onReset: () => void,
    isDefault: boolean,
    onClear?: () => void,
  ) => (
    <div className="shortcuts__row" key={key}>
      <label htmlFor={`settings-shortcut-${key}`}>{name}</label>
      <ShortcutCapture id={`settings-shortcut-${key}`} value={value} onCapture={onCapture} />
      <div className="shortcuts__buttons">
        {onClear && (
          <button
            type="button"
            className="btn"
            aria-label={t("settings.shortcuts.clearLabel", { action: name })}
            title={t("settings.shortcuts.clearLabel", { action: name })}
            disabled={value === ""}
            onClick={() => {
              setResetError(null);
              onClear();
            }}
          >
            {t("settings.shortcuts.clear")}
          </button>
        )}
        <button
          type="button"
          className="btn"
          aria-label={t("settings.shortcuts.resetLabel", { action: name })}
          title={t("settings.shortcuts.resetLabel", { action: name })}
          disabled={isDefault}
          onClick={onReset}
        >
          <span className="setting-title">
            {t("settings.shortcuts.reset")} <HelpTip text={t("settings.shortcuts.help")} />
          </span>
        </button>
      </div>
      {resetError?.row === key && <span className="form-error shortcuts__note">{resetError.message}</span>}
    </div>
  );

  return (
    <>
      <div className="shortcuts__intro">
        <button type="button" className="btn" onClick={restoreAll}>
          {t("settings.shortcuts.restoreDefaults")}
        </button>
      </div>
      {GROUPS.map((group) => (
        <section className="shortcuts__group" key={group}>
          <h3>{t(`settings.shortcuts.groups.${group}`)}</h3>
          {group === "ai" &&
            row(
              "assistant",
              assistantName,
              assistantShortcut,
              captureAssistant,
              resetAssistant,
              assistantShortcut === DEFAULT_ASSISTANT_SHORTCUT,
            )}
          {SHORTCUT_ACTION_IDS.filter((id) => SHORTCUT_ACTIONS[id].group === group).map((id) =>
            row(
              id,
              actionName(id),
              bindingsOf(id, overrides)[0] ?? "",
              captureFor(id),
              () => reset(id),
              overrides[id] === undefined,
              () => bind(id, ""),
            ),
          )}
        </section>
      ))}
      <section className="shortcuts__group">
        <h3>{t("settings.shortcuts.groups.fixed")}</h3>
        {FIXED_KEYS.map(({ keys, label }) => (
          <div className="shortcuts__row shortcuts__row--fixed" key={label}>
            <span>{t(`settings.shortcuts.fixed.${label}`)}</span>
            <kbd>{keys}</kbd>
          </div>
        ))}
      </section>
    </>
  );
}
