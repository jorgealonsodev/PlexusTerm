import { useState, type MouseEvent } from "react";
import { PowerOff } from "lucide-react";
import { useT } from "../../i18n/i18n";
import { CliIcon } from "../devmode/CliIcon";
import { ContextMenu, type ContextMenuItem } from "../menu/ContextMenu";
import type { AiUsageChoice } from "../settings/settings";
import { AI_USAGE_CHOICES } from "../settings/settings";
import { refreshUsage, useAiUsage, type UsageProvider, type UsageWindow } from "./aiUsage";

const NAMES: Record<UsageProvider, string> = { claude: "Claude Code", codex: "Codex", agy: "Antigravity", opencodeGo: "OpenCode Go" };
const ICONS: Record<UsageProvider, string> = { claude: "claude", codex: "codex", agy: "agy", opencodeGo: "opencode" };

/** One window per kind for the bar: of several model groups (Antigravity), the fullest. */
function fullestByKind(windows: UsageWindow[]): UsageWindow[] {
  const byKind = new Map<string, UsageWindow>();
  for (const w of windows) {
    const seen = byKind.get(w.kind);
    if (!seen || w.percent > seen.percent || (w.limited && !seen.limited)) byKind.set(w.kind, w);
  }
  return [...byKind.values()];
}

/** A reset time: the hour today, the day and hour later on. */
function resetTime(seconds: number, now = Date.now()): string {
  const date = new Date(seconds * 1000);
  const soon = seconds * 1000 - now < 20 * 3600 * 1000;
  return date.toLocaleString(undefined, soon ? { hour: "2-digit", minute: "2-digit" } : { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const level = (w: UsageWindow) => (w.limited ? " usage-footer__window--full" : w.percent >= 80 ? " usage-footer__window--high" : "");

/**
 * The plan usage in the bar under a terminal: the 5-hour and weekly windows of `provider`, the
 * details in the tooltip. Clicking it chooses whose usage is shown (or turns it off) or reads it
 * again. Turned off (`provider` null), it keeps only an "off" icon whose menu turns it on again.
 */
export function UsageFooter({
  provider,
  choice,
  active,
  onChoose,
}: {
  provider: UsageProvider | null;
  choice: AiUsageChoice;
  /** Whether the bar is on screen: only then is the usage read. */
  active: boolean;
  onChoose: (choice: AiUsageChoice) => void;
}) {
  const t = useT();
  const { usage, error, loading } = useAiUsage(provider, active);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const name = provider ? NAMES[provider] : "";
  const shown = fullestByKind(usage?.windows.filter((w) => w.kind !== "monthly") ?? []);
  const windowLabel = (w: UsageWindow) => t(`app.usage.${w.kind}`);

  const details = provider === null ? [t("app.usage.offTitle")] : [
    t("app.usage.title", { provider: name }),
    ...(usage?.windows ?? []).map((w) =>
      [
        `${w.group ? `${w.group}: ` : ""}${t("app.usage.windowLine", { window: t(`app.usage.${w.kind}Name`), percent: Math.round(w.percent) })}`,
        w.resetsAt !== null ? t("app.usage.resets", { time: resetTime(w.resetsAt) }) : "",
        w.limited ? t("app.usage.limited") : "",
      ]
        .filter(Boolean)
        .join(" · "),
    ),
    error ?? "",
    t("app.usage.click"),
  ].filter(Boolean);

  const open = (e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const items: ContextMenuItem[] = [
      ...AI_USAGE_CHOICES.map((c) => ({
        label: `${c === choice ? "✓ " : ""}${c === "auto" ? t("app.usage.auto") : c === "off" ? t("app.usage.off") : NAMES[c]}`,
        onSelect: () => onChoose(c),
      })),
      ...(provider
        ? [{ separator: true as const }, { label: t("app.usage.refresh"), onSelect: () => void refreshUsage(provider, true) }]
        : []),
    ];
    setMenu({ x: rect.left, y: rect.top, items });
  };

  return (
    <>
      <button
        type="button"
        className={`usage-footer${error ? " usage-footer--error" : ""}${provider ? "" : " usage-footer--off"}`}
        title={details.join("\n")}
        aria-haspopup="menu"
        aria-label={details.join(". ")}
        // Keep the keyboard focus in the terminal.
        onMouseDown={(e) => e.preventDefault()}
        onClick={open}
      >
        {provider === null ? (
          <PowerOff size={12} aria-hidden="true" />
        ) : (
          <CliIcon cli={ICONS[provider]} size={12} />
        )}
        {provider === null ? null : shown.length > 0 ? (
          shown.map((w) => (
            <span key={w.kind} className={`usage-footer__window${level(w)}`}>
              {windowLabel(w)} {Math.round(w.percent)}%
            </span>
          ))
        ) : (
          <span className="usage-footer__window usage-footer__window--empty">{loading ? "…" : "—"}</span>
        )}
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </>
  );
}
