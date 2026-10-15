import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { aiKeyStatus, aiModels, describeAiError, type AiModelInfo, type AiProvider } from "./aiClient";

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: "Anthropic",
  gemini: "Gemini",
  openai: "OpenAI",
  "opencode-go": "OpenCode Go",
  "openai-compatible": "OpenAI-compatible",
};

const ORDER: AiProvider[] = ["anthropic", "gemini", "openai", "opencode-go", "openai-compatible"];

/** One provider's part of the list: its models, or why they could not be read. */
interface Group {
  provider: AiProvider;
  models: AiModelInfo[];
  error: string | null;
  note: string | null;
}

interface ModelPickerProps {
  provider: AiProvider;
  model: string;
  /** The OpenAI-compatible server; its models are listed only when set. */
  baseUrl: string;
  onSelect: (provider: AiProvider, model: string) => void;
}

/** Whether `baseUrl` is on opencode.ai, which lists its models publicly but answers only with a key. */
function isOpenCodeHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl.trim()).hostname.toLowerCase();
    return host === "opencode.ai" || host.endsWith(".opencode.ai");
  } catch {
    return false;
  }
}

/**
 * Providers worth asking: those with a saved key, and the OpenAI-compatible server when its base URL
 * is set (a key is optional there, except on opencode.ai).
 */
async function usableProviders(baseUrl: string): Promise<AiProvider[]> {
  const hasKey = (p: AiProvider) => aiKeyStatus(p).catch(() => false);
  const usable = await Promise.all(
    ORDER.map((p) => {
      if (p !== "openai-compatible") return hasKey(p);
      if (baseUrl.trim() === "") return Promise.resolve(false);
      return isOpenCodeHost(baseUrl) ? hasKey(p) : Promise.resolve(true);
    }),
  );
  return ORDER.filter((_, i) => usable[i]);
}

/**
 * The provider/model label of the chat header; clicking it opens a scrollable list of the models of
 * every usable provider (S10). Choosing one makes it the AI provider and model.
 */
export function ModelPicker({ provider, model, baseUrl, onSelect }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [filter, setFilter] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setGroups(null);
    setFilter("");
    filterRef.current?.focus();
    usableProviders(baseUrl).then((providers) => {
      if (!live) return;
      setGroups(providers.map((p) => ({ provider: p, models: [], error: null, note: null })));
      for (const p of providers) {
        const done = (patch: Partial<Group>) =>
          live && setGroups((prev) => prev && prev.map((g) => (g.provider === p ? { ...g, ...patch } : g)));
        aiModels(p, p === "openai-compatible" ? baseUrl.trim() : undefined)
          .then((list) => done({ models: list.models, note: list.note }))
          .catch((err) => done({ error: describeAiError(err) }));
      }
    });
    const outside = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => {
      live = false;
      document.removeEventListener("mousedown", outside);
    };
  }, [open, baseUrl]);

  const choose = (p: AiProvider, m: AiModelInfo) => {
    if (!m.supported) return;
    onSelect(p, m.id);
    setOpen(false);
  };

  const options = () => Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])') ?? []);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const all = options();
    if (all.length === 0) return;
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? Math.min(at + 1, all.length - 1) : at - 1;
    if (next < 0) filterRef.current?.focus();
    else all[next].focus();
  };

  const query = filter.trim().toLowerCase();
  const matches = (p: AiProvider, m: AiModelInfo) =>
    !query || [m.name, m.id, AI_PROVIDER_LABELS[p]].some((s) => s.toLowerCase().includes(query));
  const label = `${AI_PROVIDER_LABELS[provider]}${model ? ` · ${model}` : ""}`;

  return (
    <div className="model-picker" ref={rootRef} onKeyDown={open ? onKey : undefined}>
      <button
        type="button"
        className="model-picker__button muted"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${label} — choose another model`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="model-picker__label">{label}</span>
        <ChevronDown size={12} aria-hidden />
      </button>
      {open && (
        <div className="model-picker__popover">
          <input
            ref={filterRef}
            type="search"
            className="model-picker__filter"
            aria-label="Filter models"
            placeholder="Filter models…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="model-picker__list" role="listbox" aria-label="AI models" ref={listRef}>
            {groups === null && <p className="muted model-picker__message">Loading models…</p>}
            {groups?.length === 0 && (
              <p className="muted model-picker__message">No AI provider has an API key. Add one in Settings → AI.</p>
            )}
            {groups?.map((g) => {
              const shown = g.models.filter((m) => matches(g.provider, m));
              const loading = !g.error && g.models.length === 0 && g.note === null;
              return (
                <div key={g.provider} role="group" aria-label={AI_PROVIDER_LABELS[g.provider]}>
                  {g.error && (
                    <p className="form-error model-picker__message">
                      {AI_PROVIDER_LABELS[g.provider]}: {g.error}
                    </p>
                  )}
                  {shown.map((m) => {
                    const selected = g.provider === provider && m.id === model;
                    return (
                      <div
                        key={m.id}
                        role="option"
                        tabIndex={-1}
                        aria-selected={selected}
                        aria-disabled={!m.supported || undefined}
                        className={`model-picker__option${selected ? " model-picker__option--selected" : ""}`}
                        title={m.supported ? m.id : `${m.id} — not supported yet`}
                        onClick={() => choose(g.provider, m)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            choose(g.provider, m);
                          }
                        }}
                      >
                        <span className="model-picker__name">{m.name}</span>
                        <span className="model-picker__provider">{AI_PROVIDER_LABELS[g.provider]}</span>
                      </div>
                    );
                  })}
                  {loading && query === "" && (
                    <p className="muted model-picker__message">Loading {AI_PROVIDER_LABELS[g.provider]} models…</p>
                  )}
                  {g.note && <p className="muted model-picker__message">{g.note}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
