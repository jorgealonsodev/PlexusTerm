import { targetTitle, type SessionTarget } from "../sessions/types";
import {
  closePane,
  leaf,
  neighbour,
  paneIds,
  setRatio,
  splitPane,
  type FocusDirection,
  type PaneLayout,
  type SplitDirection,
} from "../panes/paneLayout";

export interface Tab {
  key: string;
  title: string;
  target: SessionTarget;
  /** Split panes of the tab; every pane runs its own terminal for `target`. */
  layout: PaneLayout;
  focusedPane: string;
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
  | { type: "activate"; key: string }
  | { type: "rename"; key: string; title: string }
  | { type: "split"; key: string; direction: SplitDirection }
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

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case "open": {
      const pane = `pane-${state.nextPaneSeq}`;
      const tab: Tab = {
        key: `tab-${state.nextSeq}`,
        title: targetTitle(action.target),
        target: action.target,
        layout: leaf(pane),
        focusedPane: pane,
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
    case "activate":
      return state.tabs.some((t) => t.key === action.key)
        ? { ...state, activeKey: action.key }
        : state;
    case "rename":
      return {
        ...state,
        tabs: state.tabs.map((t) => (t.key === action.key ? { ...t, title: action.title } : t)),
      };
    case "split": {
      const pane = `pane-${state.nextPaneSeq}`;
      const next = updateTab(state, action.key, (tab) => {
        const layout = splitPane(tab.layout, tab.focusedPane, action.direction, pane);
        return layout === tab.layout ? tab : { ...tab, layout, focusedPane: pane };
      });
      return next === state ? state : { ...next, nextPaneSeq: state.nextPaneSeq + 1 };
    }
    case "closePane": {
      const tab = state.tabs.find((t) => t.key === action.key);
      if (!tab) return state;
      const layout = closePane(tab.layout, action.paneId);
      if (layout === null) return closeTab(state, tab.key);
      if (layout === tab.layout) return state;
      let focusedPane = tab.focusedPane;
      if (focusedPane === action.paneId) {
        // Focus the pane that now sits where the closed one was in visual order.
        const index = paneIds(tab.layout).indexOf(action.paneId);
        const remaining = paneIds(layout);
        focusedPane = remaining[Math.min(index, remaining.length - 1)];
      }
      return updateTab(state, tab.key, (t) => ({ ...t, layout, focusedPane }));
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
