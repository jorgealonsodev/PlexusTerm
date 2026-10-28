// @vitest-environment jsdom
// The real xterm and image addon (the other SharedView tests use fakes): no query the sharer's
// program sends may make this viewer type an answer into the sharer's shell.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ViewEvent } from "./viewApi";

const view = vi.hoisted(() => ({ emit: null as null | ((e: ViewEvent) => void), viewInput: vi.fn(async (_id: number, _d: string) => {}) }));
vi.mock("./viewApi", () => ({
  startView: async (_u: string, _r: string, onEvent: (e: ViewEvent) => void) => { view.emit = onEvent; return 9; },
  viewInput: view.viewInput,
  closeView: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
import { SharedView } from "./SharedView";
const target = { type: "shared" as const, url: "https://v/s/a#k", relayUrl: "wss://r", relayHost: "r" };
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const settle = () => act(() => new Promise((r) => setTimeout(r, 50)));

describe("the shared viewer never answers queries into the sharer's shell (real xterm + addon-image)", () => {
  it("DA1, XTSMGRAPHICS, window reports produce no input", async () => {
    let err: unknown = null;
    try {
      render(<SharedView target={target} active focused />);
    } catch (e) { err = e; }
    expect(err).toBeNull();
    await settle();
    await act(async () => { view.emit!({ event: "joined", data: { cols: 80, rows: 24, access: "type" } } as unknown as ViewEvent); });
    await settle();
    const queries = ["\x1b[c", "\x1b[0c", "\x1b[>c", "\x1b[?1;1S", "\x1b[?2;1S", "\x1b[?1;1;0S", "\x1b[14t", "\x1b[16t", "\x1b[18t", "\x1b[6n", "\x1b[5n", "\x1b]11;?\x07"];
    for (const q of queries) await act(async () => { view.emit!({ event: "output", data: q } as unknown as ViewEvent); });
    await settle();
    await act(() => new Promise((r) => setTimeout(r, 300)));
    expect(view.viewInput).not.toHaveBeenCalled();
  });
});
