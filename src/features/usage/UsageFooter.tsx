import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { PowerOff } from "lucide-react";
import { useT } from "../../i18n/i18n";
import { CliIcon } from "../devmode/CliIcon";
import { ContextMenu, type ContextMenuItem } from "../menu/ContextMenu";
import { formatDuration } from "../terminal/commandTimer";
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

/** " <block>--full" at the limit, " <block>--high" from 80 %, else nothing. */
const levelOf = (block: string, w: UsageWindow) => (w.limited ? ` ${block}--full` : w.percent >= 80 ? ` ${block}--high` : "");

/** How long the pointer rests on the bar before the card opens, so passing over it does not flash it. */
const CARD_DELAY_MS = 150;

/**
 * The plan usage in the bar under a terminal: the 5-hour and weekly windows of `provider`, every
 * window in detail (a bar, the percentage, when it resets) in a card while the pointer rests on it. Clicking it chooses whose usage is shown (or turns it off) or reads it
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
  /** Where the card opens: above the button, its right edge on the button's. */
  const [card, setCard] = useState<{ right: number; bottom: number } | null>(null);
  const cardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const cancelCard = () => {
    if (cardTimer.current) clearTimeout(cardTimer.current);
    cardTimer.current = null;
  };
  useEffect(() => cancelCard, []);
  const showCard = (delay: number) => {
    cancelCard();
    cardTimer.current = setTimeout(() => {
      const rect = button.current?.getBoundingClientRect();
      if (rect) setCard({ right: Math.max(8, window.innerWidth - rect.right), bottom: window.innerHeight - rect.top + 6 });
    }, delay);
  };
  const hideCard = () => {
    cancelCard();
    setCard(null);
  };
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
    hideCard();
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
        ref={button}
        aria-haspopup="menu"
        aria-label={details.join(". ")}
        // Keep the keyboard focus in the terminal.
        onMouseDown={(e) => e.preventDefault()}
        onClick={open}
        onMouseEnter={() => showCard(CARD_DELAY_MS)}
        onMouseLeave={hideCard}
        onFocus={() => showCard(0)}
        onBlur={hideCard}
      >
        {provider === null ? (
          <PowerOff size={12} aria-hidden="true" />
        ) : (
          <CliIcon cli={ICONS[provider]} size={12} />
        )}
        {provider === null ? null : shown.length > 0 ? (
          shown.map((w) => (
            <span key={w.kind} className={`usage-footer__window${levelOf("usage-footer__window", w)}`}>
              {windowLabel(w)} {Math.round(w.percent)}%
            </span>
          ))
        ) : (
          <span className="usage-footer__window usage-footer__window--empty">{loading ? "…" : "—"}</span>
        )}
      </button>
      {card &&
        !menu &&
        createPortal(
          <div className="usage-card" role="tooltip" style={{ right: card.right, bottom: card.bottom }}>
            {provider === null ? (
              <p className="usage-card__note">{t("app.usage.offTitle")}</p>
            ) : (
              <>
                <div className="usage-card__head">
                  <CliIcon cli={ICONS[provider]} size={14} />
                  <span>{t("app.usage.title", { provider: name })}</span>
                </div>
                {(usage?.windows ?? []).map((w, i) => (
                  <div key={`${w.group ?? ""}:${w.kind}:${i}`} className="usage-card__window">
                    <div className="usage-card__row">
                      <span className="usage-card__name">
                        {w.group ? `${w.group} · ` : ""}
                        {t(`app.usage.${w.kind}Name`)}
                      </span>
                      <span className={`usage-card__percent${levelOf("usage-card__percent", w)}`}>
                        {Math.round(w.percent)}%
                      </span>
                    </div>
                    <div className="usage-card__track">
                      <div
                        className={`usage-card__fill${levelOf("usage-card__fill", w)}`}
                        style={{ width: `${Math.min(100, Math.max(0, Math.round(w.percent)))}%` }}
                      />
                    </div>
                    {(w.resetsAt !== null || w.limited) && (
                      <div className="usage-card__reset">
                        {w.limited ? `${t("app.usage.limited")} · ` : ""}
                        {w.resetsAt !== null
                          ? t("app.usage.resetsIn", {
                              duration: formatDuration(Math.max(0, w.resetsAt * 1000 - Date.now())),
                              time: resetTime(w.resetsAt),
                            })
                          : ""}
                      </div>
                    )}
                  </div>
                ))}
                {!usage && !error && <p className="usage-card__note">{loading ? "…" : "—"}</p>}
                {error && <p className="usage-card__note usage-card__note--error">{error}</p>}
                <p className="usage-card__hint">{t("app.usage.click")}</p>
              </>
            )}
          </div>,
          document.body,
        )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </>
  );
}
