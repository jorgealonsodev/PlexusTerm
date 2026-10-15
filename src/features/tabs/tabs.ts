import { targetTitle, type SessionTarget } from "../sessions/types";
import {
  closePane,
  leaf,
  MAX_PANES,
  neighbour,
  paneIds,
  setRatio,
  splitPane,
  type FocusDirection,
  type PaneLayout,
  type SplitDirection,
} from "../panes/paneLayout";

/** An AI chat pane (S9) and the terminal pane its commands are inserted into. */
export interface ChatLink {
  terminalPaneId: string;
  /** Terminal selection when the chat opened, offered with its first question ("" for none). */
  selection: string;
}

export interface Tab {
  key: string;
  /** The title the shell or the user gave the tab; until then the target's title is shown. */
  title: string;
  /** False while `title` is still the target's default title (shown in the current language). */
  renamed?: boolean;
  target: SessionTarget;
  /**
   * Split panes of the tab; every pane runs its own terminal for `target`, except the
   * panes listed in `chats`, which are AI chats.
   */
  layout: PaneLayout;
  focusedPane: string;
  /** AI chat panes by pane id; at most one per terminal pane. */
  chats: Record<string, ChatLink>;
}

/** What opening the AI chat does in a tab: open one, focus one, go back to the terminal, or nothing (full tab). */
export type ChatAction =
  | { kind: "open"; terminalPaneId: string }
  | { kind: "focus"; paneId: string }
  | { kind: "terminal"; paneId: string }
  | { kind: "full" };

export function chatAction(tab: Tab): ChatAction {
  const focused = tab.focusedPane;
  const link = tab.chats[focused];
  if (link) return { kind: "terminal", paneId: link.terminalPaneId };
  const existing = Object.keys(tab.chats).find((id) => tab.chats[id].terminalPaneId === focused);
  if (existing) return { kind: "focus", paneId: existing };
  if (paneIds(tab.layout).length >= MAX_PANES) return { kind: "full" };
  return { kind: "open", terminalPaneId: focused };
}

export interface TabsState {
  tabs: Tab[];
  activeKey: string | null;
  nextSeq: number;
  nextPaneSeq: number;
}

export type TabsAction =
  | { type: "open"; target: SessionTarget }
  | { type: "close"; key: string }
  | { type: "closeOthers"; key: string }
  | { type: "closeRight"; key: string }
  | { type: "closeAll" }
  | { type: "activate"; key: string }
  | { type: "rename"; key: string; title: string }
  | { type: "split"; key: string; direction: SplitDirection }
  /** The AI chat key (S9): see `chatAction`. */
  | { type: "openChat"; key: string; selection: string }
  | { type: "closePane"; key: string; paneId: string }
  | { type: "focusPane"; key: string; paneId: string }
  | { type: "focusDirection"; key: string; direction: FocusDirection }
  | { type: "resizeSplit"; key: string; splitId: string; ratio: number };

export const initialTabs: TabsState = { tabs: [], activeKey: null, nextSeq: 1, nextPaneSeq: 1 };

function closeTab(state: TabsState, key: string): TabsState {
  const index = state.tabs.findIndex((t) => t.key === key);
  if (index === -1) return state;
  const tabs = state.tabs.filter((t) => t.key !== key);
  if (state.activeKey !== key) return { ...state, tabs };
  const neighbourTab = tabs[index] ?? tabs[index - 1] ?? null;
  return { ...state, tabs, activeKey: neighbourTab?.key ?? null };
}

/** Applies `fn` to one tab; returns the same state when the tab is unknown or unchanged. */
function updateTab(state: TabsState, key: string, fn: (tab: Tab) => Tab): TabsState {
  const tab = state.tabs.find((t) => t.key === key);
  if (!tab) return state;
  const next = fn(tab);
  return next === tab ? state : { ...state, tabs: state.tabs.map((t) => (t === tab ? next : t)) };
}

/** What the tab bar shows: the given title, or the target's title in the current language. */
export const tabTitle = (tab: Tab) => (tab.renamed === false ? targetTitle(tab.target) : tab.title);

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case "open": {
      const pane = `pane-${state.nextPaneSeq}`;
      const tab: Tab = {
        key: `tab-${state.nextSeq}`,
        title: targetTitle(action.target),
        renamed: false,
        target: action.target,
        layout: leaf(pane),
        focusedPane: pane,
        chats: {},
      };
      return {
        tabs: [...state.tabs, tab],
        activeKey: tab.key,
        nextSeq: state.nextSeq + 1,
        nextPaneSeq: state.nextPaneSeq + 1,
      };
    }
    case "close":
      return closeTab(state, action.key);
    case "closeOthers": {
      const tab = state.tabs.find((t) => t.key === action.key);
      return tab ? { ...state, tabs: [tab], activeKey: tab.key } : state;
    }
    case "closeRight": {
      const index = state.tabs.findIndex((t) => t.key === action.key);
      if (index === -1) return state;
      const tabs = state.tabs.slice(0, index + 1);
      const activeKey = tabs.some((t) => t.key === state.activeKey) ? state.activeKey : action.key;
      return { ...state, tabs, activeKey };
    }
    case "closeAll":
      return { ...state, tabs: [], activeKey: null };
    case "activate":
      return state.tabs.some((t) => t.key === action.key)
        ? { ...state, activeKey: action.key }
        : state;
    case "rename":
      return {
        ...state,
        tabs: state.tabs.map((t) => (t.key === action.key ? { ...t, title: action.title, renamed: true } : t)),
      };
    case "split": {
      const pane = `pane-${state.nextPaneSeq}`;
      const next = updateTab(state, action.key, (tab) => {
        const layout = splitPane(tab.layout, tab.focusedPane, action.direction, pane);
        return layout === tab.layout ? tab : { ...tab, layout, focusedPane: pane };
      });
      return next === state ? state : { ...next, nextPaneSeq: state.nextPaneSeq + 1 };
    }
    case "openChat": {
      const tab = state.tabs.find((t) => t.key === action.key);
      if (!tab) return state;
      const next = chatAction(tab);
      if (next.kind === "full") return state;
      if (next.kind !== "open") return tabsReducer(state, { type: "focusPane", key: tab.key, paneId: next.paneId });
      const pane = `pane-${state.nextPaneSeq}`;
      const layout = splitPane(tab.layout, next.terminalPaneId, "column", pane);
      if (layout === tab.layout) return state;
      const chats = { ...tab.chats, [pane]: { terminalPaneId: next.terminalPaneId, selection: action.selection } };
      return {
        ...updateTab(state, tab.key, (t) => ({ ...t, layout, focusedPane: pane, chats })),
        nextPaneSeq: state.nextPaneSeq + 1,
      };
    }
    case "closePane": {
      const tab = state.tabs.find((t) => t.key === action.key);
      if (!tab) return state;
      // A terminal's chat pane goes with it.
      const closing = [action.paneId, ...Object.keys(tab.chats).filter((id) => tab.chats[id].terminalPaneId === action.paneId)];
      let layout: PaneLayout | null = tab.layout;
      for (const id of closing) layout = layout && closePane(layout, id);
      if (layout === null) return closeTab(state, tab.key);
      if (layout === tab.layout) return state;
      let focusedPane = tab.focusedPane;
      const chatOf = tab.chats[action.paneId];
      if (chatOf && focusedPane === action.paneId) {
        // A closed chat gives the focus back to its terminal.
        focusedPane = chatOf.terminalPaneId;
      } else if (closing.includes(focusedPane)) {
        // Focus the pane that now sits where the closed one was in visual order.
        const index = paneIds(tab.layout).indexOf(action.paneId);
        const remaining = paneIds(layout);
        focusedPane = remaining[Math.min(index, remaining.length - 1)];
      }
      const chats = Object.fromEntries(Object.entries(tab.chats).filter(([id]) => !closing.includes(id)));
      return updateTab(state, tab.key, (t) => ({ ...t, layout: layout!, focusedPane, chats }));
    }
    case "focusPane":
      return updateTab(state, action.key, (tab) =>
        tab.focusedPane !== action.paneId && paneIds(tab.layout).includes(action.paneId)
          ? { ...tab, focusedPane: action.paneId }
          : tab,
      );
    case "focusDirection":
      return updateTab(state, action.key, (tab) => {
        const target = neighbour(tab.layout, tab.focusedPane, action.direction);
        return target ? { ...tab, focusedPane: target } : tab;
      });
    case "resizeSplit":
      return updateTab(state, action.key, (tab) => {
        const layout = setRatio(tab.layout, action.splitId, action.ratio);
        return layout === tab.layout ? tab : { ...tab, layout };
      });
  }
}
