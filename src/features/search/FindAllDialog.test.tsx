// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FindAllDialog, FIND_ALL_DEBOUNCE_MS } from "./FindAllDialog";
import { findInPanes, type BufferRow, type SearchablePane } from "./findAll";

const pane = (tabKey: string, paneId: string, tabTitle: string, lines: string[]): SearchablePane => ({
  tabKey,
  paneId,
  tabTitle,
  paneTitle: `${paneId} title`,
  rows: (): BufferRow[] => lines.map((text) => ({ text, wrapped: false })),
});
const panes = [
  pane("t1", "p1", "web", ["GET /index 200", "GET /missing 404"]),
  pane("t1", "p2", "web", ["build ok"]),
  pane("t2", "p3", "db", ["Error: GET is not SQL"]),
];

beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type Search = (query: string, options: { matchCase: boolean }) => ReturnType<typeof findInPanes>;
const open = (find: Search = (query, options) => findInPanes(panes, query, options)) => {
  const onClose = vi.fn();
  const search = vi.fn(find);
  render(<FindAllDialog search={(query, matchCase) => search(query, { matchCase })} onClose={onClose} />);
  return { onClose, search };
};
const input = () => screen.getByRole("combobox");
const type = (text: string) => {
  fireEvent.change(input(), { target: { value: text } });
  act(() => void vi.advanceTimersByTime(FIND_ALL_DEBOUNCE_MS));
};
const options = () => screen.queryAllByRole("option");

describe("FindAllDialog (S3)", () => {
  it("searches as the text is typed, after a short pause, and lists the matches by tab with the match marked", () => {
    const { search } = open();
    expect(document.activeElement).toBe(input());
    fireEvent.change(input(), { target: { value: "get" } });
    expect(search).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(FIND_ALL_DEBOUNCE_MS));
    expect(search).toHaveBeenCalledTimes(1);
    expect(options().map((o) => o.textContent)).toEqual(["GET /index 200", "GET /missing 404", "Error: GET is not SQL"]);
    expect(options()[0].querySelector("mark")?.textContent).toBe("GET");
    expect(screen.getByRole("group", { name: "web" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "db" })).toBeTruthy();
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
  });

  it("names the pane when a tab has matches in more than one", () => {
    open();
    type("i");
    const web = screen.getByRole("group", { name: "web" });
    expect(web.textContent).toContain("p1 title");
    expect(web.textContent).toContain("p2 title");
    expect(screen.getByRole("group", { name: "db" }).textContent).not.toContain("p3 title");
  });

  it("counts the results and says how to use the list", () => {
    open();
    expect(screen.getByText("↑↓ choose · Enter go · Esc close")).toBeTruthy();
    type("GET");
    expect(screen.getByText("3 results")).toBeTruthy();
  });

  it("searches again with Match case", () => {
    open();
    type("GET");
    expect(options()).toHaveLength(3);
    const matchCase = screen.getByRole("button", { name: "Match case" });
    expect(matchCase.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(matchCase);
    expect(matchCase.getAttribute("aria-pressed")).toBe("true");
    act(() => void vi.advanceTimersByTime(FIND_ALL_DEBOUNCE_MS));
    expect(options()).toHaveLength(3);
    type("get");
    expect(options()).toHaveLength(0);
    expect(screen.getByText("No terminal has this text.")).toBeTruthy();
  });

  it("says when only the first results are shown", () => {
    open(() => ({ results: findInPanes(panes, "GET", { matchCase: true }).results, capped: true }));
    type("GET");
    expect(screen.getByText("First 500 results shown.")).toBeTruthy();
  });

  it("moves with the arrows, chooses with Enter or a click, and closes with Escape", () => {
    const { onClose } = open();
    type("get");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(options()[2].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onClose).toHaveBeenLastCalledWith(expect.objectContaining({ paneId: "p3", row: 0, column: 7, length: 3 }));
    fireEvent.click(options()[1]);
    expect(onClose).toHaveBeenLastCalledWith(expect.objectContaining({ paneId: "p1", row: 1 }));
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(onClose).toHaveBeenLastCalledWith();
  });
});
