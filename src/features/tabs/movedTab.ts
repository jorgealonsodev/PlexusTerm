import type { Adoption } from "../terminal/TerminalView";
import { parseTabsDocument, type TabsDocument } from "./tabsPersist";

/**
 * A tab moved, live, from one window to a new one ("Open in new window"): the tab as tabs.json
 * saves it, the running session of each of its panes (by its pane id in the window it left) and
 * its title.
 */
export interface MovedTab {
  doc: TabsDocument;
  panes: Record<string, Adoption>;
  title: string | null;
}

const isAdoption = (value: unknown): value is Adoption => {
  if (typeof value !== "object" || value === null) return false;
  const { sessionId, tap, content } = value as Record<string, unknown>;
  return Number.isInteger(sessionId) && Number.isInteger(tap) && typeof content === "string";
};

/** The tab handed to this window, or null when there is none or it cannot be read. */
export function parseMovedTab(text: string | null): MovedTab | null {
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { doc, panes, title } = value as Record<string, unknown>;
  const parsed = parseTabsDocument(JSON.stringify(doc));
  if (!parsed || parsed.tabs.length !== 1) return null;
  const sessions: Record<string, Adoption> = {};
  if (typeof panes === "object" && panes !== null) {
    for (const [pane, adoption] of Object.entries(panes)) if (isAdoption(adoption)) sessions[pane] = adoption;
  }
  return { doc: parsed, panes: sessions, title: typeof title === "string" ? title : null };
}
