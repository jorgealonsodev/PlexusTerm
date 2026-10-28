// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ViewEvent } from "./viewApi";

const view = vi.hoisted(() => ({
  emit: null as null | ((event: ViewEvent) => void),
  startView: vi.fn(),
  viewInput: vi.fn(async () => {}),
  closeView: vi.fn(async () => {}),
}));
vi.mock("./viewApi", () => ({
  startView: (url: string, relay: string, onEvent: (event: ViewEvent) => void) => {
    view.emit = onEvent;
    return view.startView(url, relay);
  },
  viewInput: view.viewInput,
  closeView: view.closeView,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class {} }));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));

/** The handlers the pane registers on the fake terminal. */
const term = vi.hoisted(() => ({
  csi: [] as { prefix?: string; intermediates?: string; final: string }[],
  osc: [] as number[],
  dcs: [] as { intermediates?: string; final: string }[],
  data: null as null | ((data: string) => void),
  size: { cols: 0, rows: 0 },
  written: [] as string[],
  resets: 0,
  unicode: { activeVersion: "6" },
  /** The options of the last terminal created, live (the pane sets them after creation too). */
  options: {} as Record<string, unknown>,
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: Record<string, unknown>;
    unicode = term.unicode;
    constructor(options: Record<string, unknown> = {}) {
      this.options = { ...options };
      term.options = this.options;
    }
    parser = {
      registerCsiHandler: (id: { final: string }) => (term.csi.push(id), { dispose() {} }),
      registerOscHandler: (ident: number) => (term.osc.push(ident), { dispose() {} }),
      registerDcsHandler: (id: { final: string }) => (term.dcs.push(id), { dispose() {} }),
    };
    loadAddon() {}
    attachCustomKeyEventHandler() {}
    open() {}
    focus() {}
    dispose() {}
    hasSelection() {
      return false;
    }
    onData(handler: (data: string) => void) {
      term.data = handler;
      return { dispose() {} };
    }
    onBinary() {
      return { dispose() {} };
    }
    resize(cols: number, rows: number) {
      term.size = { cols, rows };
    }
    reset() {
      term.resets++;
    }
    write(data: string) {
      term.written.push(data);
    }
  },
}));

import { DEFAULT_SETTINGS, type TerminalSettings } from "../settings/settings";
import { SharedView } from "./SharedView";

const target = { type: "shared" as const, url: "https://view.example.com/s/abc#key", relayUrl: "wss://relay.example.com", relayHost: "relay.example.com" };

async function opened(settings?: TerminalSettings) {
  view.startView.mockResolvedValue(8);
  render(<SharedView target={target} active settings={settings} />);
  await act(async () => {});
  return (event: ViewEvent) => act(async () => view.emit!(event));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Object.assign(term, { csi: [], osc: [], dcs: [], data: null, written: [], resets: 0 });
});

describe("SharedView (P3)", () => {
  it("joins through the confirmed relay and keeps the sharer's size", async () => {
    const emit = await opened();
    expect(view.startView).toHaveBeenCalledWith(target.url, target.relayUrl);
    await emit({ event: "waiting" });
    expect(screen.getByText("Waiting for the sharer to let you in")).toBeTruthy();
    await emit({ event: "joined", data: { access: "view", cols: 120, rows: 40 } });
    expect(term.size).toEqual({ cols: 120, rows: 40 });
    expect(term.unicode.activeVersion).toBe("11");
    await emit({ event: "output", data: "hello" });
    expect(term.written).toEqual(["hello"]);
    const untrusted = screen.getByText("Terminal of another computer");
    expect(untrusted.closest("[title]")?.getAttribute("title")).toContain("cannot use your clipboard");
  });

  it("types only with Can type, while live and not paused", async () => {
    const emit = await opened();
    await emit({ event: "joined", data: { access: "view", cols: 80, rows: 24 } });
    term.data!("a");
    expect(view.viewInput).not.toHaveBeenCalled();
    await emit({ event: "access", data: "type" });
    term.data!("b");
    expect(view.viewInput).toHaveBeenCalledWith(8, "b");
    await emit({ event: "inputPaused", data: true });
    term.data!("c");
    await emit({ event: "inputPaused", data: false });
    await emit({ event: "reconnecting", data: { retryIn: 1 } });
    term.data!("d");
    expect(view.viewInput.mock.calls.map((c) => (c as unknown[])[1])).toEqual(["b"]);
  });

  it("never answers terminal queries nor writes the clipboard for the remote program", async () => {
    await opened();
    expect(term.csi).toEqual(expect.arrayContaining([{ final: "c" }, { prefix: ">", final: "c" }, { final: "n" }, { prefix: "?", final: "n" }]));
    expect(term.dcs).toEqual([{ intermediates: "$", final: "q" }]);
    expect(term.osc).toEqual(expect.arrayContaining([10, 11, 52]));
  });

  it("clears the pane and says why when the share is over for it", async () => {
    const emit = await opened();
    await emit({ event: "done", data: { reason: "refused", code: "not_found" } });
    expect(term.resets).toBe(1);
    expect(screen.getByText("This share has ended or the link is wrong. Ask for a new link.")).toBeTruthy();
    await emit({ event: "done", data: { reason: "refused", code: "version" } });
    expect(screen.getByText("Update PlexusTerm to open this share")).toBeTruthy();
    expect(screen.getByText("Open in the browser")).toBeTruthy();
  });

  it("draws the cursor of the settings and follows their changes", async () => {
    view.startView.mockResolvedValue(8);
    const { rerender } = render(
      <SharedView target={target} active settings={{ ...DEFAULT_SETTINGS, cursorShape: "block", cursorBlink: false }} />,
    );
    await act(async () => {});
    expect(term.options).toMatchObject({ cursorStyle: "block", cursorBlink: false });
    rerender(<SharedView target={target} active settings={{ ...DEFAULT_SETTINGS, cursorShape: "underline", fontSize: 18 }} />);
    expect(term.options).toMatchObject({ cursorStyle: "underline", cursorBlink: true, fontSize: 18 });
  });

  it("draws a blinking bar cursor with the default settings", async () => {
    await opened();
    expect(term.options).toMatchObject({ cursorStyle: "bar", cursorWidth: 2, cursorBlink: true });
  });

  it("closes its connection when the pane closes", async () => {
    await opened();
    cleanup();
    expect(view.closeView).toHaveBeenCalledWith(8);
  });
});
