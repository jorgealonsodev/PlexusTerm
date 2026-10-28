import { Plus, Trash2 } from "lucide-react";
import { useT } from "../../i18n/i18n";
import { HelpTip } from "../sidebar/HelpTip";
import type { Macro } from "../macros/macros";
import { DEFAULT_RULE_COLOR, MAX_ACTION_TEXT, MAX_RULES, ruleError, type HighlightRule, type RuleAction } from "../terminal/highlightRules";

interface HighlightRulesEditorProps {
  rules: HighlightRule[];
  onChange: (rules: HighlightRule[]) => void;
  /** The saved macros a rule's "Play macro" action can pick from. */
  macros?: readonly Pick<Macro, "id" | "name">[];
}

type ActionKind = "none" | RuleAction["kind"];

/**
 * The highlight rules, one row each: the regular expression, its colour, match case and notify,
 * and under it the rule's action (S3): none, text to send or a macro to play.
 * A rule left without an expression is dropped when Settings close; an invalid one says why.
 */
export function HighlightRulesEditor({ rules, onChange, macros = [] }: HighlightRulesEditorProps) {
  const t = useT();
  const change = (index: number, patch: Partial<HighlightRule>) =>
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  /** Sets or (undefined) removes a rule's action, without leaving an `action` key behind. */
  const setAction = (index: number, action: RuleAction | undefined) =>
    onChange(
      rules.map((rule, i) => {
        if (i !== index) return rule;
        const { action: _old, ...rest } = rule;
        return action ? { ...rest, action } : rest;
      }),
    );
  const pickKind = (index: number, kind: ActionKind) => {
    if (kind === "none") setAction(index, undefined);
    // Text is kept while being typed even when empty; an empty one is dropped when Settings close.
    else if (kind === "send") setAction(index, { kind: "send", text: "" });
    else setAction(index, { kind: "macro", macroId: macros[0]?.id ?? "" });
  };

  return (
    <div className="rules">
      <p className="muted rules__intro">{t("settings.terminal.highlightRulesHelp")}</p>
      {rules.map((rule, index) => {
        const error = rule.pattern.trim() ? ruleError(rule) : null;
        const n = index + 1;
        return (
          <div className="rules__rule" key={index}>
            <div className="rules__row">
              <input
                className="rules__pattern"
                aria-label={t("settings.terminal.rulePattern", { n })}
                placeholder={t("settings.terminal.rulePatternPlaceholder")}
                spellCheck={false}
                autoCapitalize="off"
                value={rule.pattern}
                aria-invalid={error !== null}
                onChange={(e) => change(index, { pattern: e.target.value })}
              />
              <input
                type="color"
                aria-label={t("settings.terminal.ruleColor", { n })}
                value={rule.color}
                onChange={(e) => change(index, { color: e.target.value })}
              />
              <label className="check">
                <input type="checkbox" checked={rule.matchCase} onChange={(e) => change(index, { matchCase: e.target.checked })} />
                <span>{t("settings.terminal.ruleMatchCase")}</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={rule.notify} onChange={(e) => change(index, { notify: e.target.checked })} />
                <span>{t("settings.terminal.ruleNotify")}</span>
              </label>
              <button
                type="button"
                className="btn btn--icon"
                aria-label={t("settings.terminal.ruleRemove", { n })}
                title={t("settings.terminal.ruleRemove", { n })}
                onClick={() => onChange(rules.filter((_, i) => i !== index))}
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="rules__row">
              <select
                aria-label={t("settings.terminal.ruleAction", { n })}
                value={rule.action?.kind ?? "none"}
                onChange={(e) => pickKind(index, e.target.value as ActionKind)}
              >
                <option value="none">{t("settings.terminal.ruleActionNone")}</option>
                <option value="send">{t("settings.terminal.ruleActionSend")}</option>
                <option value="macro">{t("settings.terminal.ruleActionMacro")}</option>
              </select>
              {rule.action?.kind === "send" && (
                <input
                  className="rules__pattern"
                  aria-label={t("settings.terminal.ruleActionText", { n })}
                  placeholder={t("settings.terminal.ruleActionTextPlaceholder")}
                  spellCheck={false}
                  autoCapitalize="off"
                  maxLength={MAX_ACTION_TEXT}
                  value={rule.action.text}
                  onChange={(e) => setAction(index, { kind: "send", text: e.target.value })}
                />
              )}
              {rule.action?.kind === "macro" && (
                <select
                  aria-label={t("settings.terminal.ruleActionMacroPick", { n })}
                  value={rule.action.macroId}
                  onChange={(e) => setAction(index, { kind: "macro", macroId: e.target.value })}
                >
                  {!macros.some((m) => m.id === (rule.action as { macroId: string }).macroId) && (
                    <option value={rule.action.macroId}>
                      {t(macros.length === 0 ? "settings.terminal.ruleActionNoMacros" : "settings.terminal.ruleActionMacroGone")}
                    </option>
                  )}
                  {macros.map((macro) => (
                    <option key={macro.id} value={macro.id}>
                      {macro.name}
                    </option>
                  ))}
                </select>
              )}
              <HelpTip text={t("settings.terminal.ruleActionHelp")} />
            </div>
            {error && (
              <span className="form-error" role="alert">
                {t("settings.terminal.ruleInvalid", { error })}
              </span>
            )}
          </div>
        );
      })}
      <button
        type="button"
        className="btn btn--icon"
        disabled={rules.length >= MAX_RULES}
        onClick={() => onChange([...rules, { pattern: "", color: DEFAULT_RULE_COLOR, matchCase: false, notify: false }])}
      >
        <Plus size={14} />
        {t("settings.terminal.ruleAdd")}
      </button>
    </div>
  );
}
