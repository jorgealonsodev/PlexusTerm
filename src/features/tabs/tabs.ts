import { targetTitle, type SessionTarget } from "../sessions/types";

export interface Tab {
  key: string;
  title: string;
  target: SessionTarget;
}

export interface TabsState {
  tabs: Tab[];
  activeKey: string | null;
  nextSeq: number;
}

export type TabsAction =
  | { type: "open"; target: SessionTarget }
  | { type: "close"; key: string }
  | { type: "activate"; key: string }
  | { type: "rename"; key: string; title: string };

export const initialTabs: TabsState = { tabs: [], activeKey: null, nextSeq: 1 };

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case "open": {
      const tab = { key: `tab-${state.nextSeq}`, title: targetTitle(action.target), target: action.target };
      return { tabs: [...state.tabs, tab], activeKey: tab.key, nextSeq: state.nextSeq + 1 };
    }
    case "close": {
      const index = state.tabs.findIndex((t) => t.key === action.key);
      if (index === -1) return state;
      const tabs = state.tabs.filter((t) => t.key !== action.key);
      if (state.activeKey !== action.key) return { ...state, tabs };
      const neighbour = tabs[index] ?? tabs[index - 1] ?? null;
      return { ...state, tabs, activeKey: neighbour?.key ?? null };
    }
    case "activate":
      return state.tabs.some((t) => t.key === action.key)
        ? { ...state, activeKey: action.key }
        : state;
    case "rename":
      return {
        ...state,
        tabs: state.tabs.map((t) => (t.key === action.key ? { ...t, title: action.title } : t)),
      };
  }
}
