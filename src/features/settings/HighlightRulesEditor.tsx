import { Plus, Trash2 } from "lucide-react";
import { useT } from "../../i18n/i18n";
import { DEFAULT_RULE_COLOR, MAX_RULES, ruleError, type HighlightRule } from "../terminal/highlightRules";

interface HighlightRulesEditorProps {
  rules: HighlightRule[];
  onChange: (rules: HighlightRule[]) => void;
}

/**
 * The highlight rules, one row each: the regular expression, its colour, match case and notify.
 * A rule left without an expression is dropped when Settings close; an invalid one says why.
 */
export function HighlightRulesEditor({ rules, onChange }: HighlightRulesEditorProps) {
  const t = useT();
  const change = (index: number, patch: Partial<HighlightRule>) =>
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));

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
