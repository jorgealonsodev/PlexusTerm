// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  start: vi.fn((_options?: unknown, _onEvent?: unknown) => new Promise<number>(() => {})),
  write: vi.fn(() => Promise.resolve()),
  resize: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
}));

const flow = vi.hoisted(() => ({ setTerminalFlow: vi.fn(async (_tap: number, _paused: boolean) => {}) }));
vi.mock("./backend", () => ({ backendFor: () => backend, setTerminalFlow: flow.setTerminalFlow }));
/** While `held`, the fake xterm keeps write callbacks (output not parsed yet) until `release`. */
const parsing = vi.hoisted(() => ({
  held: false,
  queue: [] as (() => void)[],
  release() {
    const callbacks = parsing.queue.splice(0);
    callbacks.forEach((callback) => callback());
  },
}));
const clipboard = vi.hoisted(() => ({ readText: vi.fn(async () => ""), writeText: vi.fn(async () => {}) }));
vi.mock("./clipboard", () => clipboard);
// Only the keyring commands reach `invoke` here (the backend is mocked): a keyring is available.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => true) }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
// Error colouring is tested on its own (errorHighlight.test.ts); here only its wiring is checked.
const errors = vi.hoisted(() => ({
  refresh: vi.fn(),
  dispose: vi.fn(),
  enabled: null as null | (() => boolean),
}));
vi.mock("./errorHighlight", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./errorHighlight")>()),
  attachErrorHighlight: (_term: unknown, options: { enabled: () => boolean }) => {
    errors.enabled = options.enabled;
    return { refresh: errors.refresh, dispose: errors.dispose };
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(async () => "/tmp/session.log") }));
const opener = vi.hoisted(() => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/plugin-opener", () => opener);

/** Every fake xterm created, newest last. */
const terms = vi.hoisted(() => [] as FakeTerminal[]);
interface FakeTerminal {
  linkProviders: import("@xterm/xterm").ILinkProvider[];
  resize(cols: number, rows: number): void;
  options: { fontSize?: number; fontFamily?: string; theme?: { background?: string } };
  unicode: { activeVersion: string };
  keyHandler: (e: Partial<KeyboardEvent>) => boolean;
  paste: ReturnType<typeof vi.fn>;
  modes: { bracketedPasteMode: boolean };
  clear: ReturnType<typeof vi.fn>;
  selectAll: ReturnType<typeof vi.fn>;
  written: string[];
  /** The cursor line on screen; the cursor sits at its end. */
  line: string;
  bufferType: "normal" | "alternate";
  /** What xterm's onData would emit for typed keys. */
  type: (data: string) => void;
  /** Sends an OSC sequence's data to the handler registered for `ident`; false when none is. */
  osc: (ident: number, data: string) => boolean;
  /** Rings the bell (BEL), as xterm's onBell does. */
  bell: () => void;
  /** Addons loaded into the terminal, in order. */
  addons: unknown[];
}

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options: { fontSize?: number; fontFamily?: string; theme?: { background?: string } };
    oscHandlers = new Map<number, (data: string) => boolean>();
    unicode = { activeVersion: "6" };
    parser = {
      registerOscHandler: (ident: number, handler: (data: string) => boolean) => {
        this.oscHandlers.set(ident, handler);
        return { dispose: () => this.oscHandlers.delete(ident) };
      },
    };
    osc(ident: number, data: string) {
      return this.oscHandlers.get(ident)?.(data) ?? false;
    }
    bellHandlers: (() => void)[] = [];
    onBell = (handler: () => void) => {
      this.bellHandlers.push(handler);
      return { dispose() {} };
    };
    bell() {
      this.bellHandlers.forEach((handler) => handler());
    }
    keyHandler: (e: unknown) => boolean = () => true;
    paste = vi.fn();
    modes = { bracketedPasteMode: false };
    clear = vi.fn();
    selectAll = vi.fn();
    line = "";
    bufferType = "normal";
    get buffer() {
      const line = this.line;
      const row = {
        isWrapped: false,
        length: line.length,
        getCell: (x: number) => ({ getChars: () => line[x] ?? "", getWidth: () => 1 }),
        translateToString: (trim?: boolean, start = 0, end?: number) =>
          trim ? line.slice(start, end).trimEnd() : line.slice(start, end),
      };
      return {
        active: {
          type: this.bufferType,
          length: 1,
          cursorX: line.length,
          cursorY: 0,
          baseY: 0,
          viewportY: 0,
          getLine: (i: number) => (i === 0 ? row : undefined),
        },
      };
    }
    /** Markers (OSC 133 B) on the only row there is. */
    registerMarker() {
      const marker = { line: 0, isDisposed: false, dispose: () => void (marker.isDisposed = true) };
      return marker;
    }
    dataHandlers: ((data: string) => void)[] = [];
    type(data: string) {
      this.dataHandlers.forEach((handler) => handler(data));
    }
    constructor(options: { fontSize?: number; fontFamily?: string; theme?: { background?: string } }) {
      this.options = { ...options };
      terms.push(this as unknown as FakeTerminal);
    }
    addons: unknown[] = [];
    loadAddon(addon: unknown) {
      this.addons.push(addon);
    }
    linkProviders: import("@xterm/xterm").ILinkProvider[] = [];
    registerLinkProvider(provider: import("@xterm/xterm").ILinkProvider) {
      this.linkProviders.push(provider);
      return { dispose: () => {} };
    }
    attachCustomKeyEventHandler(handler: (e: unknown) => boolean) {
      this.keyHandler = handler;
    }
    open() {}
    written: string[] = [];
    write(text: string, callback?: () => void) {
      this.written.push(text);
      if (parsing.held && callback) parsing.queue.push(callback);
      else callback?.();
    }
    focus() {}
    dispose() {}
    hasSelection() {
      return false;
    }
    getSelection() {
      return "";
    }
    onData = (handler: (data: string) => void) => {
      this.dataHandlers.push(handler);
      return { dispose() {} };
    };
    onWriteParsed = () => ({ dispose() {} });
    onCursorMove = () => ({ dispose() {} });
    onScroll = () => ({ dispose() {} });
    resizeHandlers: ((size: { cols: number; rows: number }) => void)[] = [];
    onResize = (handler: (size: { cols: number; rows: number }) => void) => {
      this.resizeHandlers.push(handler);
      return { dispose() {} };
    };
    resize(cols: number, rows: number) {
      this.resizeHandlers.forEach((handler) => handler({ cols, rows }));
    }
    titleHandlers: ((title: string) => void)[] = [];
    onTitleChange = (handler: (title: string) => void) => {
      this.titleHandlers.push(handler);
      return { dispose() {} };
    };
    setTitle(title: string) {
      this.titleHandlers.forEach((handler) => handler(title));
    }
  },
}));
/** How many times a terminal was fitted to its pane. */
const fits = vi.hoisted(() => ({ count: 0 }));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {
      fits.count++;
    }
  },
}));
/** Every fake WebGL renderer created, newest last; `failNext` makes the next one fail to load. */
const webgl = vi.hoisted(() => ({
  addons: [] as { disposed: boolean; loseContext: () => void }[],
  failNext: false,
}));
// A shared pane's snapshots: what was written, cut to the screen when `scrollback` is 0.
vi.mock("@xterm/addon-serialize", () => ({
  SerializeAddon: class {
    serialize(options?: { scrollback?: number }) {
      const term = terms[terms.length - 1];
      const all = term.written.join("");
      return options?.scrollback === 0 ? `SCREEN:${term.line}` : `FULL(${options?.scrollback}):${all}`;
    }
  },
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    disposed = false;
    lossHandlers: (() => void)[] = [];
    constructor() {
      if (webgl.failNext) {
        webgl.failNext = false;
        throw new Error("WebGL2 not supported");
      }
      webgl.addons.push(this);
    }
    onContextLoss(handler: () => void) {
      this.lossHandlers.push(handler);
      return { dispose() {} };
    }
    loseContext() {
      this.lossHandlers.forEach((handler) => handler());
    }
    dispose() {
      this.disposed = true;
    }
  },
}));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    findNext() {
      return true;
    }
    findPrevious() {
      return true;
    }
    clearDecorations() {}
  },
}));

import { invoke } from "@tauri-apps/api/core";
import { forgetWebglProbe } from "./webglProbe";
import { ACTIVITY_QUIET_MS, CONNECT_WAIT_SHOWN_S, FONT_WAIT_MS, TITLE_MS, TerminalView } from "./TerminalView";
import { DEFAULT_SETTINGS } from "../settings/settings";
import { createHistoryStore } from "../history/historyStore";
import { PlatformContext } from "../platform/usePlatform";

const lastTerm = () => terms[terms.length - 1];

globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  parsing.held = false;
  parsing.queue = [];
});

describe("TerminalView", () => {
  describe("output flow control", () => {
    const started = async () => {
      let emit: (msg: import("./backend").TerminalEvent) => void = () => {};
      backend.start.mockImplementationOnce((_options, onEvent) => {
        emit = onEvent as typeof emit;
        return Promise.resolve(7);
      });
      const view = render(<TerminalView target={{ type: "local" }} active onTitle={() => {}} onExit={() => {}} />);
      await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
      act(() => emit({ event: "tap", data: 42 }));
      return { emit: (msg: import("./backend").TerminalEvent) => act(() => emit(msg)), view };
    };
    const chunk = "x".repeat(64 * 1024);

    it("pauses the session once while xterm has a large backlog, and resumes it once xterm caught up", async () => {
      const { emit } = await started();
      parsing.held = true;
      for (let i = 0; i < 12; i++) emit({ event: "output", data: chunk });
      expect(flow.setTerminalFlow.mock.calls).toEqual([[42, true]]);
      act(() => parsing.release());
      expect(flow.setTerminalFlow.mock.calls).toEqual([
        [42, true],
        [42, false],
      ]);
      // Every chunk still reached the terminal, in order.
      expect(lastTerm().written.filter((text) => text === chunk)).toHaveLength(12);
    });

    it("output xterm keeps up with never pauses the session", async () => {
      const { emit } = await started();
      for (let i = 0; i < 40; i++) emit({ event: "sharedOutput", data: { data: chunk, seq: i + 1 } });
      expect(flow.setTerminalFlow).not.toHaveBeenCalled();
      expect(lastTerm().written.filter((text) => text === chunk)).toHaveLength(40);
    });

    it("resumes a paused session when the pane closes", async () => {
      const { emit, view } = await started();
      parsing.held = true;
      for (let i = 0; i < 12; i++) emit({ event: "output", data: chunk });
      view.unmount();
      expect(flow.setTerminalFlow.mock.calls).toEqual([
        [42, true],
        [42, false],
      ]);
    });
  });

  it("opens the backend session once under StrictMode (serial ports allow a single opener)", async () => {
    render(
      <StrictMode>
        <TerminalView
          target={{ type: "serial", path: "/dev/ttyUSB9", baud: 115200, dataBits: 8, parity: "none", stopBits: 1, flow: "none" }}
          active
          onTitle={() => {}}
          onExit={() => {}}
        />
      </StrictMode>,
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(backend.start).toHaveBeenCalledTimes(1);
  });

  it("never opens a session when unmounted before the deferred start", async () => {
    const { unmount } = render(<TerminalView target={{ type: "local" }} active onTitle={() => {}} onExit={() => {}} />);
    unmount();
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(backend.start).not.toHaveBeenCalled();
  });

  it("starts the shell once the fonts have loaded, at its final size (no resize while it starts)", async () => {
    let fontsLoaded: () => void = () => {};
    const fonts = Object.assign(new EventTarget(), { ready: new Promise<void>((resolve) => (fontsLoaded = resolve)) });
    Object.defineProperty(document, "fonts", { configurable: true, value: fonts });
    const shown = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent")!;
    Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get: () => document.body });
    try {
      render(<TerminalView target={{ type: "local" }} active onTitle={() => {}} onExit={() => {}} />);
      await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
      expect(backend.start).not.toHaveBeenCalled();
      const fitsBefore = fits.count;
      await act(async () => fontsLoaded());
      await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
      expect(backend.start).toHaveBeenCalledTimes(1);
      expect(fits.count).toBeGreaterThan(fitsBefore);
    } finally {
      delete (document as { fonts?: unknown }).fonts;
      Object.defineProperty(HTMLElement.prototype, "offsetParent", shown);
    }
  });

  it("starts the shell anyway when the fonts take too long", async () => {
    vi.useFakeTimers();
    const fonts = Object.assign(new EventTarget(), { ready: new Promise<void>(() => {}) });
    Object.defineProperty(document, "fonts", { configurable: true, value: fonts });
    try {
      render(<TerminalView target={{ type: "local" }} active onTitle={() => {}} onExit={() => {}} />);
      await act(async () => void vi.advanceTimersByTime(100));
      expect(backend.start).not.toHaveBeenCalled();
      await act(async () => void vi.advanceTimersByTime(FONT_WAIT_MS));
      expect(backend.start).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      delete (document as { fonts?: unknown }).fonts;
    }
  });

  it("passes title changes on at most every TITLE_MS, ending with the latest title", async () => {
    vi.useFakeTimers();
    try {
      const onTitle = vi.fn();
      render(<TerminalView target={{ type: "local" }} active onTitle={onTitle} onExit={() => {}} />);
      const term = terms[terms.length - 1] as unknown as { setTitle: (t: string) => void };
      for (let i = 0; i < 20; i++) term.setTitle(`working ${i}`);
      expect(onTitle).toHaveBeenCalledTimes(1);
      expect(onTitle).toHaveBeenLastCalledWith("working 0");
      await act(async () => void vi.advanceTimersByTime(TITLE_MS));
      expect(onTitle).toHaveBeenCalledTimes(2);
      expect(onTitle).toHaveBeenLastCalledWith("working 19");
      await act(async () => void vi.advanceTimersByTime(TITLE_MS * 3));
      expect(onTitle).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  describe("terminal comfort (S15)", () => {
    // The webview's navigator.clipboard cannot read in WebKitGTK: the app goes through ./clipboard.
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: () => Promise.reject(new Error("denied")), writeText: () => Promise.reject(new Error("denied")) },
      configurable: true,
    });
    const term = () => terms[terms.length - 1];
    const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    const renderView = (props: Partial<Parameters<typeof TerminalView>[0]> = {}) =>
      render(<TerminalView target={{ type: "local" }} active onTitle={() => {}} onExit={() => {}} {...props} />);
    const rightClick = (container: HTMLElement, mods: { ctrlKey?: boolean } = {}) => {
      const host = container.querySelector(".terminal-host")!;
      fireEvent.mouseDown(host, { button: 2, ...mods });
      fireEvent.contextMenu(host, { clientX: 5, clientY: 6, ...mods });
    };

    it("measures emoji as two cells, as the programs that draw them do", () => {
      renderView();
      expect(term().unicode.activeVersion).toBe("11");
    });

    it("draws a thin bar cursor, not a block", () => {
      renderView();
      expect(term().options).toMatchObject({ cursorStyle: "bar", cursorWidth: 2 });
    });

    it("colours error lines again when the setting or the scheme changes, and stops on close", () => {
      const view = (settings: typeof DEFAULT_SETTINGS) => (
        <TerminalView target={{ type: "local" }} active onTitle={() => {}} onExit={() => {}} settings={settings} />
      );
      const { rerender, unmount } = render(view(DEFAULT_SETTINGS));
      errors.refresh.mockClear();
      errors.dispose.mockClear();
      expect(errors.enabled?.()).toBe(true);
      rerender(view({ ...DEFAULT_SETTINGS, errorHighlight: false }));
      expect(errors.enabled?.()).toBe(false);
      expect(errors.refresh).toHaveBeenCalledTimes(1);
      rerender(view({ ...DEFAULT_SETTINGS, errorHighlight: false, theme: "nord" }));
      expect(errors.refresh).toHaveBeenCalledTimes(2);
      unmount();
      expect(errors.dispose).toHaveBeenCalledTimes(1);
    });

    it("colours error lines again once, after a window resize settles", () => {
      vi.useFakeTimers();
      try {
        renderView();
        errors.refresh.mockClear();
        term().resize(100, 30);
        term().resize(110, 32);
        term().resize(120, 34);
        expect(errors.refresh).not.toHaveBeenCalled();
        vi.advanceTimersByTime(150);
        expect(errors.refresh).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("enables the proposed API that colours the error lines", () => {
      renderView();
      expect((term().options as { allowProposedApi?: boolean }).allowProposedApi).toBe(true);
    });

    it("starts with the font size of the settings and follows its changes", () => {
      const { rerender } = renderView({ settings: { ...DEFAULT_SETTINGS, fontSize: 18 } });
      expect(term().options.fontSize).toBe(18);
      rerender(
        <TerminalView
          target={{ type: "local" }}
          active
          onTitle={() => {}}
          onExit={() => {}}
          settings={{ ...DEFAULT_SETTINGS, fontSize: 22 }}
        />,
      );
      expect(term().options.fontSize).toBe(22);
    });

    it("starts with the line height of the settings and follows its changes", () => {
      const { rerender } = renderView({ settings: { ...DEFAULT_SETTINGS, lineHeight: 1 } });
      expect(term().options).toMatchObject({ lineHeight: 1 });
      rerender(
        <TerminalView
          target={{ type: "local" }}
          active
          onTitle={() => {}}
          onExit={() => {}}
          settings={{ ...DEFAULT_SETTINGS, lineHeight: 1.25 }}
        />,
      );
      expect(term().options).toMatchObject({ lineHeight: 1.25 });
    });

    it("starts with the font weight of the settings, bold a step heavier, and follows its changes", () => {
      const { rerender } = renderView({ settings: { ...DEFAULT_SETTINGS, fontWeight: 300 } });
      expect(term().options).toMatchObject({ fontWeight: 300, fontWeightBold: 600 });
      rerender(
        <TerminalView
          target={{ type: "local" }}
          active
          onTitle={() => {}}
          onExit={() => {}}
          settings={{ ...DEFAULT_SETTINGS, fontWeight: 500 }}
        />,
      );
      expect(term().options).toMatchObject({ fontWeight: 500, fontWeightBold: 800 });
    });

    it("starts with the colour scheme and font of the settings and follows their changes", () => {
      const view = (settings: typeof DEFAULT_SETTINGS) => (
        <TerminalView target={{ type: "local" }} active onTitle={() => {}} onExit={() => {}} settings={settings} />
      );
      const before = terms.length;
      const { container, rerender } = render(view({ ...DEFAULT_SETTINGS, theme: "nord", fontFamily: "Fira Code" }));
      const host = container.querySelector(".terminal-host") as HTMLElement;
      expect(term().options.theme?.background).toBe("#2e3440");
      expect(term().options.fontFamily).toBe('"Fira Code", monospace');
      expect(host.style.background).toBe("rgb(46, 52, 64)");
      rerender(view({ ...DEFAULT_SETTINGS, theme: "catppuccin-latte" }));
      expect(term().options.theme?.background).toBe("#eff1f5");
      expect(term().options.fontFamily).toBe(DEFAULT_SETTINGS.fontFamily);
      expect(host.style.background).toBe("rgb(239, 241, 245)");
      expect(terms.length - before).toBe(1);
    });

    it("pastes a single line from the clipboard on right click", async () => {
      clipboard.readText.mockResolvedValueOnce("ls -la");
      const { container } = renderView();
      rightClick(container);
      await settle();
      expect(term().paste).toHaveBeenCalledWith("ls -la");
    });

    it("sends an empty paste when the clipboard holds an image, so an AI CLI attaches it", async () => {
      clipboard.readText.mockResolvedValueOnce("");
      const { container } = renderView();
      rightClick(container);
      await settle();
      expect(term().paste).toHaveBeenCalledWith("");
    });

    it("sends an empty paste instead of an error when the clipboard has no text and the program asked for bracketed paste", async () => {
      clipboard.readText.mockRejectedValueOnce("The clipboard contents were not available in the requested format");
      const { container } = renderView();
      term().modes.bracketedPasteMode = true;
      rightClick(container);
      await settle();
      expect(term().paste).toHaveBeenCalledWith("");
      expect(term().written.join("")).not.toContain("Could not read the clipboard.");
    });

    it("still reports an unreadable clipboard at a shell prompt", async () => {
      clipboard.readText.mockRejectedValueOnce("The clipboard contents were not available in the requested format");
      const { container } = renderView();
      rightClick(container);
      await settle();
      expect(term().paste).not.toHaveBeenCalled();
      expect(term().written.join("")).toContain("Could not read the clipboard.");
    });

    it("asks before pasting several lines and can stop asking", async () => {
      clipboard.readText.mockResolvedValueOnce("one\ntwo");
      const onSettingsChange = vi.fn();
      const { container } = renderView({ onSettingsChange });
      rightClick(container);
      expect(await screen.findByText("Paste 2 lines?")).toBeTruthy();
      expect(term().paste).not.toHaveBeenCalled();
      fireEvent.click(screen.getByLabelText("Don't ask again"));
      fireEvent.click(screen.getByRole("button", { name: "Paste" }));
      expect(term().paste).toHaveBeenCalledWith("one\ntwo");
      expect(onSettingsChange).toHaveBeenCalledWith({ confirmMultilinePaste: false });
      expect(screen.queryByText("Paste 2 lines?")).toBeNull();
    });

    it("opens the context menu on right click when right click does not paste, or on Ctrl+right click", async () => {
      const { container } = renderView({ settings: { ...DEFAULT_SETTINGS, rightClickPastes: false } });
      rightClick(container);
      fireEvent.click(screen.getByRole("menuitem", { name: "Clear scrollback" }));
      expect(term().clear).toHaveBeenCalled();
      expect(screen.queryByRole("menu")).toBeNull();
      cleanup();
      const second = renderView();
      rightClick(second.container, { ctrlKey: true });
      fireEvent.click(screen.getByRole("menuitem", { name: "Select all" }));
      expect(term().selectAll).toHaveBeenCalled();
      expect(clipboard.readText).not.toHaveBeenCalled();
    });

    it("opens the menu on right click over selected text even when right click pastes (S7)", async () => {
      const onAskAi = vi.fn();
      const { container } = renderView({ onAskAi });
      const select = (text: string) => {
        const t = term() as unknown as { hasSelection: () => boolean; getSelection: () => string };
        t.hasSelection = () => text !== "";
        t.getSelection = () => text;
      };
      const items = () => screen.getAllByRole("menuitem").map((item) => item.textContent);
      select("https://example.com/docs");
      rightClick(container);
      expect(clipboard.readText).not.toHaveBeenCalled();
      expect(items().slice(0, 6)).toEqual([
        "Copy",
        "Ask the AI about it",
        "Type at the prompt",
        "Find in terminal",
        "Open link",
        "Paste",
      ]);
      fireEvent.click(screen.getByRole("menuitem", { name: "Open link" }));
      expect(opener.openUrl).toHaveBeenCalledWith("https://example.com/docs");

      select("error: disk full\nsecond line");
      rightClick(container);
      expect(items()).not.toContain("Open link");
      fireEvent.click(screen.getByRole("menuitem", { name: "Ask the AI about it" }));
      expect(onAskAi).toHaveBeenCalledTimes(1);

      rightClick(container);
      fireEvent.click(screen.getByRole("menuitem", { name: "Find in terminal" }));
      expect((screen.getByRole("textbox", { name: "Find in terminal" }) as HTMLInputElement).value).toBe("error: disk full");

      select("make test");
      rightClick(container);
      fireEvent.click(screen.getByRole("menuitem", { name: "Type at the prompt" }));
      expect(term().paste).toHaveBeenCalledWith("make test");

      // Without a selection, right click still pastes; the menu has no selection items.
      select("");
      clipboard.readText.mockResolvedValueOnce("ls");
      rightClick(container);
      await settle();
      expect(term().paste).toHaveBeenLastCalledWith("ls");
      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("right click on a word still pastes when xterm selects the word on right click (macOS)", async () => {
      clipboard.readText.mockClear();
      clipboard.readText.mockResolvedValueOnce("ls");
      const { container } = renderView();
      const host = container.querySelector(".terminal-host")!;
      // xterm's own contextmenu listener selects the word under the pointer before ours runs.
      host.addEventListener("contextmenu", () => {
        const t = term() as unknown as { hasSelection: () => boolean; getSelection: () => string };
        t.hasSelection = () => true;
        t.getSelection = () => "word";
      });
      rightClick(container);
      expect(screen.queryAllByRole("menuitem")).toEqual([]);
      expect(clipboard.readText).toHaveBeenCalled();
    });

    it("has no Ask the AI item without a chat to open", () => {
      const { container } = renderView({ settings: { ...DEFAULT_SETTINGS, rightClickPastes: false } });
      const t = term() as unknown as { hasSelection: () => boolean; getSelection: () => string };
      t.hasSelection = () => true;
      t.getSelection = () => "x";
      rightClick(container);
      expect(screen.queryByRole("menuitem", { name: "Ask the AI about it" })).toBeNull();
      expect(screen.getByRole("menuitem", { name: "Type at the prompt" })).toBeTruthy();
    });

    it("keeps Ctrl+Shift+F from the shell and opens the find bar; Escape closes it", async () => {
      renderView();
      let passed = true;
      act(() => {
        passed = term().keyHandler({ type: "keydown", key: "F", ctrlKey: true, shiftKey: true, altKey: false, metaKey: false });
      });
      expect(passed).toBe(false);
      const input = screen.getByLabelText("Find in terminal");
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByLabelText("Find in terminal")).toBeNull();
    });

    it("keeps the assistant shortcut from the shell, following its setting (S3)", () => {
      const { rerender } = renderView();
      const press = (key: string, mods: Partial<KeyboardEvent>) =>
        term().keyHandler({ type: "keydown", key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
      expect(press(" ", { ctrlKey: true, shiftKey: true })).toBe(false);
      expect(press(" ", { ctrlKey: true })).toBe(true);
      rerender(
        <TerminalView
          target={{ type: "local" }}
          active
          onTitle={() => {}}
          onExit={() => {}}
          settings={{ ...DEFAULT_SETTINGS, assistantShortcut: "Alt+K" }}
        />,
      );
      expect(press("k", { altKey: true })).toBe(false);
      expect(press(" ", { ctrlKey: true, shiftKey: true })).toBe(true);
    });

    it("lets the user's app shortcuts through and keeps the freed default for the shell", () => {
      renderView({ settings: { ...DEFAULT_SETTINGS, shortcuts: { newTerminal: "Alt+N", nextTab: "Ctrl+PageDown" } } });
      const press = (key: string, mods: Partial<KeyboardEvent>) =>
        term().keyHandler({ type: "keydown", key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
      expect(press("n", { altKey: true })).toBe(false);
      expect(press("PageDown", { ctrlKey: true })).toBe(false);
      expect(press("T", { ctrlKey: true, shiftKey: true })).toBe(true);
      // Default app shortcuts still stay out of the shell.
      expect(press("D", { ctrlKey: true, shiftKey: true })).toBe(false);
    });

    describe("GPU acceleration (WebGL renderer)", () => {
      const view = (gpuAcceleration: boolean) => (
        <TerminalView
          target={{ type: "local" }}
          active
          onTitle={() => {}}
          onExit={() => {}}
          settings={{ ...DEFAULT_SETTINGS, gpuAcceleration }}
        />
      );
      const lastWebgl = () => webgl.addons[webgl.addons.length - 1];

      it("draws with WebGL when it is on, after the terminal is open", () => {
        const before = webgl.addons.length;
        render(view(true));
        expect(webgl.addons.length).toBe(before + 1);
        expect(term().addons).toContain(lastWebgl());
      });

      it("keeps xterm's own renderer when it is off, and switches live both ways", () => {
        const before = webgl.addons.length;
        const { rerender } = render(view(false));
        expect(webgl.addons.length).toBe(before);
        rerender(view(true));
        expect(webgl.addons.length).toBe(before + 1);
        const addon = lastWebgl();
        rerender(view(false));
        expect(addon.disposed).toBe(true);
      });

      it("falls back to xterm's own renderer when the WebGL context is lost", () => {
        render(view(true));
        const addon = lastWebgl();
        addon.loseContext();
        expect(addon.disposed).toBe(true);
      });

      describe("fits the pane again when the cell size may change", () => {
        // jsdom lays nothing out: the pane counts as shown.
        const shown = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent")!;
        beforeEach(() => {
          Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get: () => document.body });
        });
        afterEach(() => {
          Object.defineProperty(HTMLElement.prototype, "offsetParent", shown);
        });

        it("after the renderer changes (WebGL measures cells its own way)", () => {
          const { rerender } = render(view(false));
          const before = fits.count;
          rerender(view(true));
          expect(fits.count).toBeGreaterThan(before);
          const afterOn = fits.count;
          lastWebgl().loseContext();
          expect(fits.count).toBeGreaterThan(afterOn);
        });

        it("once the fonts have loaded", async () => {
          const fonts = new EventTarget() as EventTarget & { ready: Promise<unknown> };
          fonts.ready = Promise.resolve();
          Object.defineProperty(document, "fonts", { configurable: true, value: fonts });
          try {
            render(view(false));
            await act(async () => {});
            const before = fits.count;
            act(() => void fonts.dispatchEvent(new Event("loadingdone")));
            expect(fits.count).toBeGreaterThan(before);
          } finally {
            delete (document as { fonts?: unknown }).fonts;
          }
        });
      });

      it("keeps xterm's own renderer when WebGL is drawn in software (llvmpipe)", () => {
        forgetWebglProbe();
        const gl = {
          getExtension: (name: string) => (name === "WEBGL_debug_renderer_info" ? { UNMASKED_RENDERER_WEBGL: 1 } : null),
          getParameter: () => "llvmpipe (LLVM 15.0.7, 256 bits)",
        };
        const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(gl as never);
        try {
          const before = webgl.addons.length;
          render(view(true));
          expect(webgl.addons.length).toBe(before);
        } finally {
          getContext.mockRestore();
          forgetWebglProbe();
        }
      });

      it("falls back without an error when WebGL cannot start", () => {
        webgl.failNext = true;
        const before = webgl.addons.length;
        expect(() => render(view(true))).not.toThrow();
        expect(webgl.addons.length).toBe(before);
        expect(term()).toBeTruthy();
      });

      it("notes in the diagnostic log when WebGL cannot start or loses its context", () => {
        const logged = () =>
          vi.mocked(invoke).mock.calls.filter(([name]) => name === "diag_log").map(([, args]) => args);
        webgl.failNext = true;
        const { unmount } = render(view(true));
        expect(logged()).toContainEqual({
          level: "warn",
          message: "terminal WebGL renderer failed to start (Error: WebGL2 not supported); xterm's renderer is used",
        });
        unmount();
        render(view(true));
        lastWebgl().loseContext();
        expect(logged()).toContainEqual({
          level: "warn",
          message: "terminal lost its WebGL context (GPU reset or sleep); xterm's renderer takes over",
        });
      });
    });

    describe("attention requests from command-line tools", () => {
      it("reports a bell and the OSC 9, 777 and 99 notifications, with their text", () => {
        const onAttention = vi.fn();
        renderView({ onAttention });
        term().bell();
        expect(onAttention).toHaveBeenLastCalledWith({ title: null, body: null });
        expect(term().osc(9, "\n\nClaude is waiting for your input")).toBe(true);
        expect(onAttention).toHaveBeenLastCalledWith({ title: null, body: "Claude is waiting for your input" });
        expect(term().osc(777, "notify;Claude Code;Task finished")).toBe(true);
        expect(onAttention).toHaveBeenLastCalledWith({ title: "Claude Code", body: "Task finished" });
        term().osc(99, "i=3:d=0:p=title;Codex");
        term().osc(99, "i=3:p=body;Approval needed");
        expect(onAttention).toHaveBeenLastCalledWith({ title: "Codex", body: "Approval needed" });
        expect(onAttention).toHaveBeenCalledTimes(4);
      });

      it("ignores progress reports (OSC 9;4), which Claude Code sends while it works", () => {
        const onAttention = vi.fn();
        renderView({ onAttention });
        term().osc(9, "4;3;");
        term().osc(9, "4;1;40");
        expect(onAttention).not.toHaveBeenCalled();
      });

      it("reads the folder Windows shells report through OSC 9;9, and asks for no attention", () => {
        const onCwd = vi.fn();
        const onAttention = vi.fn();
        const onPrompt = vi.fn();
        renderView({ onCwd, onAttention, onPrompt });
        term().osc(9, '9;"C:\\Users\\me\\project"');
        expect(onCwd).toHaveBeenLastCalledWith("C:\\Users\\me\\project");
        term().osc(9, "9;D:\\work");
        expect(onCwd).toHaveBeenLastCalledWith("D:\\work");
        expect(onAttention).not.toHaveBeenCalled();
        expect(onPrompt).toHaveBeenCalled();
      });

      it("still keeps the folder reported through OSC 7", () => {
        const onCwd = vi.fn();
        renderView({ onCwd });
        term().osc(7, "file://host/home/me/project");
        expect(onCwd).toHaveBeenCalledWith("/home/me/project");
      });
    });

    describe("prompt signal (git branch refresh)", () => {
      it("signals the prompt when the shell reports its folder (OSC 7) or marks a prompt (OSC 133)", () => {
        const onPrompt = vi.fn();
        renderView({ onPrompt });
        term().osc(7, "file://host/home/me");
        term().osc(7, "file://host/home/me");
        expect(onPrompt).toHaveBeenCalledTimes(2);
        term().osc(133, "A");
        term().osc(133, "D;0");
        expect(onPrompt).toHaveBeenCalledTimes(4);
        // Command start / output start marks are not a prompt.
        term().osc(133, "B");
        term().osc(133, "C");
        expect(onPrompt).toHaveBeenCalledTimes(4);
      });

      it("without shell integration, signals once the output of a command sent with Enter goes quiet", async () => {
        vi.useFakeTimers();
        try {
          const onPrompt = vi.fn();
          let emit: (msg: { event: "output"; data: string }) => void = () => {};
          backend.start.mockImplementationOnce((_options, onEvent) => {
            emit = onEvent as typeof emit;
            return Promise.resolve(7);
          });
          renderView({ onPrompt });
          await act(() => vi.advanceTimersByTimeAsync(10));
          // Output without a command (a banner) is no prompt.
          act(() => emit({ event: "output", data: "Welcome\r\n$ " }));
          await act(() => vi.advanceTimersByTimeAsync(2000));
          expect(onPrompt).not.toHaveBeenCalled();
          act(() => term().type("git checkout -b topic\r"));
          act(() => emit({ event: "output", data: "Switched to a new branch 'topic'\r\n" }));
          await act(() => vi.advanceTimersByTimeAsync(100));
          act(() => emit({ event: "output", data: "$ " }));
          await act(() => vi.advanceTimersByTimeAsync(2000));
          expect(onPrompt).toHaveBeenCalledTimes(1);
        } finally {
          vi.useRealTimers();
        }
      });
    });

    describe("DEV mode signals (S10)", () => {
      it("tells whether the prompt came from a shell mark or from quiet output", async () => {
        vi.useFakeTimers();
        try {
          const onPrompt = vi.fn();
          let emit: (msg: { event: "output"; data: string }) => void = () => {};
          backend.start.mockImplementationOnce((_options, onEvent) => {
            emit = onEvent as typeof emit;
            return Promise.resolve(7);
          });
          renderView({ onPrompt });
          await act(() => vi.advanceTimersByTimeAsync(10));
          term().osc(133, "A");
          expect(onPrompt).toHaveBeenLastCalledWith(true);
          act(() => term().type("ls\r"));
          act(() => emit({ event: "output", data: "a b\r\n$ " }));
          await act(() => vi.advanceTimersByTimeAsync(1000));
          expect(onPrompt).toHaveBeenLastCalledWith(false);
        } finally {
          vi.useRealTimers();
        }
      });

      it("reports each command sent with Enter with the prompt it was typed after", async () => {
        const onCommand = vi.fn();
        await renderView({ onCommand });
        act(() => void (term().line = "me@box:~/proj$ "));
        act(() => term().type("claude"));
        act(() => void (term().line = "me@box:~/proj$ claude"));
        act(() => term().type("\r"));
        expect(onCommand).toHaveBeenCalledWith("claude", "me@box:~/proj$ ");
      });

      it("reads the command off the screen when it came from history or completion", async () => {
        const onCommand = vi.fn();
        await renderView({ onCommand });
        act(() => void (term().line = "me@box:~/proj$ "));
        // Up arrow: the shell writes a recalled command the typed-line tracker cannot follow.
        act(() => term().type("\x1b[A"));
        act(() => void (term().line = "me@box:~/proj$ codex"));
        act(() => term().type("\r"));
        expect(onCommand).toHaveBeenCalledWith("codex", "me@box:~/proj$ ");
        // Tab completion.
        onCommand.mockClear();
        act(() => void (term().line = "me@box:~/proj$ "));
        act(() => term().type("cod\t"));
        act(() => void (term().line = "me@box:~/proj$ codex "));
        act(() => term().type("\r"));
        expect(onCommand).toHaveBeenCalledWith("codex", "me@box:~/proj$ ");
      });

      it("reports no command typed at a password prompt", async () => {
        const onCommand = vi.fn();
        await renderView({ onCommand });
        act(() => void (term().line = "[sudo] password for jorge: "));
        act(() => term().type("claude\r"));
        expect(onCommand).not.toHaveBeenCalled();
      });

      it("reports the text before the cursor whenever output goes quiet, only when asked", async () => {
        vi.useFakeTimers();
        try {
          const onOutputQuiet = vi.fn();
          let emit: (msg: { event: "output"; data: string }) => void = () => {};
          backend.start.mockImplementationOnce((_options, onEvent) => {
            emit = onEvent as typeof emit;
            return Promise.resolve(7);
          });
          const { rerender } = render(<TerminalView target={{ type: "local" }} active onTitle={() => {}} onExit={() => {}} />);
          await act(() => vi.advanceTimersByTimeAsync(10));
          act(() => emit({ event: "output", data: "x" }));
          await act(() => vi.advanceTimersByTimeAsync(1000));
          rerender(
            <TerminalView target={{ type: "local" }} active onTitle={() => {}} onExit={() => {}} onOutputQuiet={onOutputQuiet} />,
          );
          act(() => void (term().line = "me@box:~/proj$ "));
          act(() => emit({ event: "output", data: "me@box:~/proj$ " }));
          await act(() => vi.advanceTimersByTimeAsync(100));
          expect(onOutputQuiet).not.toHaveBeenCalled();
          await act(() => vi.advanceTimersByTimeAsync(1000));
          expect(onOutputQuiet).toHaveBeenCalledTimes(1);
          expect(onOutputQuiet).toHaveBeenCalledWith("me@box:~/proj$ ");
        } finally {
          vi.useRealTimers();
        }
      });
    });

    it("reports when its output starts and when it stops for a while, not the echo of what is typed", async () => {
      vi.useFakeTimers();
      try {
        const onActivity = vi.fn();
        let emit: (msg: { event: "output"; data: string }) => void = () => {};
        backend.start.mockImplementationOnce((_options, onEvent) => {
          emit = onEvent as typeof emit;
          return Promise.resolve(7);
        });
        render(<TerminalView target={{ type: "local" }} active onTitle={() => {}} onExit={() => {}} onActivity={onActivity} />);
        await act(() => vi.advanceTimersByTimeAsync(10));
        // The echo of a key is not the program working.
        act(() => term().type("a"));
        act(() => emit({ event: "output", data: "a" }));
        expect(onActivity).not.toHaveBeenCalled();
        await act(() => vi.advanceTimersByTimeAsync(500));
        // Output nobody typed for: working, once, until it stops for ACTIVITY_QUIET_MS.
        act(() => emit({ event: "output", data: "⠂ Thinking" }));
        await act(() => vi.advanceTimersByTimeAsync(800));
        act(() => emit({ event: "output", data: "⠐ Thinking" }));
        expect(onActivity.mock.calls).toEqual([[true]]);
        await act(() => vi.advanceTimersByTimeAsync(ACTIVITY_QUIET_MS - 100));
        expect(onActivity.mock.calls).toEqual([[true]]);
        await act(() => vi.advanceTimersByTimeAsync(200));
        expect(onActivity.mock.calls).toEqual([[true], [false]]);
      } finally {
        vi.useRealTimers();
      }
    });

    describe("Shift+Enter in AI command-line tools", () => {
      const press = (key: string, mods: Partial<KeyboardEvent> = {}, type = "keydown") =>
        term().keyHandler({ type, key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
      const connected = async (settings = DEFAULT_SETTINGS) => {
        backend.start.mockImplementationOnce(() => Promise.resolve(7));
        const view = renderView({ settings });
        await settle();
        return view;
      };

      it("sends a line feed (Ctrl+J), the new-line key of Claude Code, Codex, Gemini CLI and OpenCode", async () => {
        const onInput = vi.fn();
        backend.start.mockImplementationOnce(() => Promise.resolve(7));
        renderView({ onInput });
        await settle();
        let passed = true;
        act(() => {
          passed = press("Enter", { shiftKey: true });
        });
        expect(passed).toBe(false);
        expect(backend.write).toHaveBeenCalledTimes(1);
        expect(backend.write).toHaveBeenCalledWith(7, "\n");
        // Like typing: multi-execution and macros see it too.
        expect(onInput).toHaveBeenCalledWith("\n");
        // keypress / keyup of the same key are kept from xterm without sending again.
        expect(press("Enter", { shiftKey: true }, "keypress")).toBe(false);
        expect(press("Enter", { shiftKey: true }, "keyup")).toBe(false);
        expect(backend.write).toHaveBeenCalledTimes(1);
      });

      it("leaves Enter, Ctrl+Enter, Alt+Enter and Ctrl+Shift+Enter to xterm unchanged", async () => {
        await connected();
        for (const mods of [{}, { ctrlKey: true }, { altKey: true }, { ctrlKey: true, shiftKey: true }, { metaKey: true, shiftKey: true }]) {
          expect(press("Enter", mods)).toBe(true);
        }
        expect(backend.write).not.toHaveBeenCalled();
      });

      it("sends Enter's carriage return like before when the setting is off", async () => {
        await connected({ ...DEFAULT_SETTINGS, shiftEnterNewline: false });
        expect(press("Enter", { shiftKey: true })).toBe(true);
        expect(backend.write).not.toHaveBeenCalled();
      });

      it("leaves a key being composed by an input method alone", async () => {
        await connected();
        expect(press("Enter", { shiftKey: true, isComposing: true })).toBe(true);
        expect(backend.write).not.toHaveBeenCalled();
      });
    });

    it("runs the pane actions bound by the user: select all and clear", () => {
      renderView({ settings: { ...DEFAULT_SETTINGS, shortcuts: { selectAll: "Alt+A", clear: "Alt+L" } } });
      const press = (key: string, mods: Partial<KeyboardEvent>) =>
        term().keyHandler({ type: "keydown", key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
      act(() => void press("a", { altKey: true }));
      expect(term().selectAll).toHaveBeenCalled();
      act(() => void press("l", { altKey: true }));
      expect(term().clear).toHaveBeenCalled();
    });

    it("hands the assistant the pane's selection and a way to focus it back (S3)", () => {
      let assist: { selection: () => string; focus: () => void } | null = null;
      const unregister = vi.fn();
      const { unmount } = renderView({
        registerAssistTarget: (target) => {
          assist = target;
          return unregister;
        },
      });
      expect(assist!.selection()).toBe("");
      const t = term() as unknown as { hasSelection: () => boolean; getSelection: () => string; focus: () => void };
      t.hasSelection = () => true;
      t.getSelection = () => "error: permission denied";
      t.focus = vi.fn();
      expect(assist!.selection()).toBe("error: permission denied");
      assist!.focus();
      expect(t.focus).toHaveBeenCalled();
      unmount();
      expect(unregister).toHaveBeenCalled();
    });

    it("links the paths it prints to the files its fileLinks find, opened with Ctrl+click", async () => {
      const first = { resolve: vi.fn(async () => null), open: vi.fn() };
      const { rerender } = renderView({ fileLinks: first });
      await settle();
      const t = term();
      t.line = "Wrote docs/PRD.md";
      const links = () =>
        new Promise<import("@xterm/xterm").ILink[] | undefined>((done) => t.linkProviders[0].provideLinks(1, done));
      expect(await links()).toBeUndefined();
      // The latest fileLinks are used, without a new terminal.
      const latest = { resolve: vi.fn(async (text: string) => `/work/${text}`), open: vi.fn() };
      rerender(<TerminalView target={{ type: "local" }} active onTitle={() => {}} onExit={() => {}} fileLinks={latest} />);
      const [link] = (await links())!;
      expect(latest.resolve).toHaveBeenCalledWith("docs/PRD.md");
      link.activate(new MouseEvent("click", { ctrlKey: true }), link.text);
      expect(latest.open).toHaveBeenCalledWith("/work/docs/PRD.md");
      expect(t.linkProviders).toHaveLength(1);
    });

    it("logs received output to the chosen file without escape sequences", async () => {
      let emit: (msg: { event: string; data: unknown }) => void = () => {};
      backend.start.mockImplementationOnce((_options, onEvent) => {
        emit = onEvent as typeof emit;
        return Promise.resolve(7);
      });
      const onLogging = vi.fn();
      const { container, unmount } = renderView({
        settings: { ...DEFAULT_SETTINGS, rightClickPastes: false },
        onLogging,
      });
      await settle();
      rightClick(container);
      fireEvent.click(screen.getByRole("menuitem", { name: "Log to file…" }));
      await vi.waitFor(() => expect(onLogging).toHaveBeenCalledWith("/tmp/session.log"));
      act(() => emit({ event: "output", data: "\x1b[1mbold\x1b[0m\r\n" }));
      unmount(); // closing the pane flushes the log
      await vi.waitFor(() =>
        expect(vi.mocked(invoke)).toHaveBeenCalledWith("append_text_file", { path: "/tmp/session.log", contents: "bold\n" }),
      );
    });
  });

  describe("Telnet (S17.1)", () => {
    const target = { type: "telnet" as const, host: "switch.lan", port: 23 };

    it("warns that Telnet is not encrypted before connecting", async () => {
      render(<TerminalView target={target} active onTitle={() => {}} onExit={() => {}} />);
      await vi.waitFor(() => expect(backend.start).toHaveBeenCalledTimes(1));
      const written = lastTerm().written;
      expect(written[0]).toBe("\x1b[33mTelnet is not encrypted.\x1b[0m\r\n");
      expect(written[1]).toBe("Connecting to switch.lan:23...\r\n");
    });

    it("shows connection errors without asking for a password", async () => {
      backend.start.mockImplementationOnce(() =>
        Promise.reject({ kind: "connection", message: "cannot connect to switch.lan:23: refused" }),
      );
      render(<TerminalView target={target} active onTitle={() => {}} onExit={() => {}} />);
      await vi.waitFor(() =>
        expect(lastTerm().written).toContain("\x1b[31mcannot connect to switch.lan:23: refused\x1b[0m\r\n"),
      );
      expect(screen.queryByLabelText("Password")).toBeNull();
    });
  });

  describe("Mosh (S17.2)", () => {
    const target = {
      type: "mosh" as const,
      ssh: {
        type: "ssh" as const,
        host: "10.0.0.1",
        port: 22,
        username: "u",
        auth: { method: "storedPassword" as const, sessionId: "s1" },
      },
    };

    it("says it starts the server over SSH", async () => {
      render(<TerminalView target={target} active onTitle={() => {}} onExit={() => {}} />);
      await vi.waitFor(() => expect(backend.start).toHaveBeenCalledTimes(1));
      expect(lastTerm().written[0]).toBe("Starting mosh-server on u@10.0.0.1 over SSH...\r\n");
    });

    it("asks for the SSH password when the saved one is rejected, then retries with it", async () => {
      backend.start.mockImplementationOnce(() => Promise.reject({ kind: "authFailed" }));
      render(<TerminalView target={target} active onTitle={() => {}} onExit={() => {}} />);
      const box = await screen.findByLabelText<HTMLInputElement>("Save password in the system keyring");
      expect(box.checked).toBe(true);
      await vi.waitFor(() => expect(box.disabled).toBe(false));
      fireEvent.change(screen.getByLabelText("Password"), { target: { value: "new" } });
      fireEvent.click(screen.getByText("Connect"));
      await vi.waitFor(() => expect(backend.start).toHaveBeenCalledTimes(2));
      expect(backend.start.mock.calls[1][0]).toMatchObject({
        auth: { method: "password", password: "new" },
        storage: { action: "remember", sessionId: "s1", label: "PlexusTerm: u@10.0.0.1:22" },
      });
    });

    it("keeps the pane open when mosh-client fails, and closes it on a clean exit", async () => {
      const onExit = vi.fn();
      let emit: (event: unknown) => void = () => {};
      backend.start.mockImplementation((_options, onEvent) => {
        emit = onEvent as (event: unknown) => void;
        return Promise.resolve(3);
      });
      render(<TerminalView target={target} active onTitle={() => {}} onExit={onExit} />);
      await vi.waitFor(() => expect(backend.start).toHaveBeenCalledTimes(1));
      await act(async () => emit({ event: "exit", data: 1 }));
      expect(onExit).not.toHaveBeenCalled();
      expect(lastTerm().written.slice(-1)[0]).toBe(
        "\r\n[mosh-client exited with code 1. Close this tab or open the session again.]\r\n",
      );
      cleanup();
      render(<TerminalView target={target} active onTitle={() => {}} onExit={onExit} />);
      await vi.waitFor(() => expect(backend.start).toHaveBeenCalledTimes(2));
      await act(async () => emit({ event: "exit", data: 0 }));
      expect(onExit).toHaveBeenCalledWith(0);
      backend.start.mockReset();
      backend.start.mockImplementation(() => new Promise<number>(() => {}));
    });
  });

  describe("while a host does not answer", () => {
    const target = { type: "ssh" as const, host: "10.9.9.9", port: 22, username: "u", auth: { method: "agent" as const } };

    it("counts the seconds after a moment, and Ctrl+C cancels the connection, closing it if it opens later", async () => {
      vi.useFakeTimers();
      try {
        let open: (id: number) => void = () => {};
        backend.start.mockImplementationOnce(() => new Promise<number>((resolve) => (open = resolve)));
        const onSession = vi.fn();
        render(<TerminalView target={target} active onTitle={() => {}} onExit={() => {}} onSession={onSession} />);
        await act(async () => void vi.advanceTimersByTime(FONT_WAIT_MS + 10));
        expect(backend.start).toHaveBeenCalledTimes(1);
        const text = () => lastTerm().written.join("");
        await act(async () => void vi.advanceTimersByTime(2000));
        expect(text()).not.toContain("Waiting for the host");
        await act(async () => void vi.advanceTimersByTime((CONNECT_WAIT_SHOWN_S - 1) * 1000));
        expect(text()).toContain(`Waiting for the host… ${CONNECT_WAIT_SHOWN_S} s (Ctrl+C cancels)`);

        // Other keys are not sent anywhere; Ctrl+C cancels.
        act(() => lastTerm().type("ls"));
        expect(backend.write).not.toHaveBeenCalled();
        act(() => lastTerm().type("\x03"));
        expect(text()).toContain("[Connection cancelled]");
        const before = text();
        await act(async () => void vi.advanceTimersByTime(5000));
        expect(text()).toBe(before);

        // The connection opening after all is closed at once and never becomes the pane's session.
        await act(async () => open(42));
        expect(backend.close).toHaveBeenCalledWith(42);
        expect(onSession).not.toHaveBeenCalledWith(42);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("with a saved password", () => {
    const target = {
      type: "ssh" as const,
      host: "10.0.0.1",
      port: 22,
      username: "u",
      auth: { method: "storedPassword" as const, sessionId: "s1" },
    };
    const SAVE = "Save password in the system keyring";

    async function rejectFirstStartWith(err: unknown) {
      backend.start.mockImplementationOnce(() => Promise.reject(err));
      render(<TerminalView target={target} active onTitle={() => {}} onExit={() => {}} />);
      return screen.findByLabelText<HTMLInputElement>(SAVE);
    }

    it("asks for the password with the checkbox ticked when it is rejected, then retries with it", async () => {
      const box = await rejectFirstStartWith({ kind: "authFailed" });
      expect(box.checked).toBe(true);
      await vi.waitFor(() => expect(box.disabled).toBe(false));
      fireEvent.change(screen.getByLabelText("Password"), { target: { value: "new" } });
      fireEvent.click(screen.getByText("Connect"));
      await vi.waitFor(() => expect(backend.start).toHaveBeenCalledTimes(2));
      expect(backend.start.mock.calls[1][0]).toMatchObject({
        auth: { method: "password", password: "new" },
        storage: { action: "remember", sessionId: "s1", label: "PlexusTerm: u@10.0.0.1:22" },
      });
    });

    it("forgets the saved password when the checkbox is unticked after it was rejected", async () => {
      const box = await rejectFirstStartWith({ kind: "authFailed" });
      await vi.waitFor(() => expect(box.disabled).toBe(false));
      fireEvent.click(box);
      fireEvent.change(screen.getByLabelText("Password"), { target: { value: "new" } });
      fireEvent.click(screen.getByText("Connect"));
      await vi.waitFor(() => expect(backend.start).toHaveBeenCalledTimes(2));
      expect(backend.start.mock.calls[1][0]).toMatchObject({ storage: { action: "forget", sessionId: "s1" } });
    });

    it("connects first and asks only when no password is saved, unticked like a first login", async () => {
      const box = await rejectFirstStartWith({ kind: "secretMissing" });
      expect(backend.start).toHaveBeenCalledTimes(1);
      expect(backend.start.mock.calls[0][0]).not.toHaveProperty("auth");
      expect(box.checked).toBe(false);
      await vi.waitFor(() => expect(box.disabled).toBe(false));
      fireEvent.change(screen.getByLabelText("Password"), { target: { value: "new" } });
      fireEvent.click(screen.getByText("Connect"));
      await vi.waitFor(() => expect(backend.start).toHaveBeenCalledTimes(2));
      const retry = backend.start.mock.calls[1][0] as { auth: unknown; storage?: unknown };
      expect(retry.auth).toEqual({ method: "password", password: "new" });
      expect(retry.storage).toBeUndefined();
      // A first password login is not an error: no red "No saved password" line.
      expect(terms[terms.length - 1].written.join("")).not.toContain("No saved password");
    });

    it("does not prompt for other failures", async () => {
      backend.start.mockImplementationOnce(() => Promise.reject({ kind: "connection", message: "refused" }));
      render(<TerminalView target={target} active onTitle={() => {}} onExit={() => {}} />);
      await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
      expect(screen.queryByLabelText("Password")).toBeNull();
    });
  });

  describe("through a jump host", () => {
    const fingerprint = "SHA256:jump";
    const target = (auth: { method: "agent" } | { method: "storedPassword"; sessionId: string }) => ({
      type: "ssh" as const,
      host: "10.0.0.1",
      port: 22,
      username: "u",
      auth: { method: "agent" as const },
      jumps: [{ name: "bastion", host: "10.0.0.9", port: 22, username: "j", auth }],
    });

    it("asks to trust an unknown jump host, naming it, and retries with that hop's fingerprint", async () => {
      backend.start.mockImplementationOnce(() =>
        Promise.reject({
          kind: "hop",
          hop: 1,
          name: "bastion",
          error: { kind: "unknownHost", host: "10.0.0.9", fingerprint, otherKnownKeys: [] },
        }),
      );
      render(<TerminalView target={target({ method: "agent" })} active onTitle={() => {}} onExit={() => {}} />);
      await screen.findByText("Unknown jump host");
      expect(screen.getByText(/bastion — jump host 1 of 1/)).toBeTruthy();
      fireEvent.click(screen.getByText("Trust and connect"));
      await vi.waitFor(() => expect(backend.start).toHaveBeenCalledTimes(2));
      const options = backend.start.mock.calls[1][0] as { trustedFingerprint?: string; jumps: unknown[] };
      expect(options.trustedFingerprint).toBeUndefined();
      expect(options.jumps).toEqual([{ ...target({ method: "agent" }).jumps[0], trustedFingerprint: fingerprint }]);
    });

    it("asks for a jump host password its saved one failed, and retries with it for that hop only", async () => {
      backend.start.mockImplementationOnce(() =>
        Promise.reject({ kind: "hop", hop: 1, name: "bastion", error: { kind: "authFailed" } }),
      );
      const t = target({ method: "storedPassword", sessionId: "j1" });
      render(<TerminalView target={t} active onTitle={() => {}} onExit={() => {}} />);
      await screen.findByText("Password for bastion — jump host 1 of 1");
      const box = screen.getByLabelText<HTMLInputElement>("Save password in the system keyring");
      await vi.waitFor(() => expect(box.disabled).toBe(false));
      fireEvent.change(screen.getByLabelText("Password"), { target: { value: "jpw" } });
      fireEvent.click(screen.getByText("Connect"));
      await vi.waitFor(() => expect(backend.start).toHaveBeenCalledTimes(2));
      const options = backend.start.mock.calls[1][0] as { auth?: unknown; jumps: unknown[] };
      expect(options.auth).toBeUndefined();
      expect(options.jumps).toEqual([
        {
          ...t.jumps[0],
          auth: { method: "password", password: "jpw" },
          storage: { action: "remember", sessionId: "j1", label: "PlexusTerm: j@10.0.0.9:22" },
        },
      ]);
    });
  });

  describe("inline suggestions (S1)", () => {
    const term = () => lastTerm();
    const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    const ghost = (container: HTMLElement) => container.querySelector(".terminal-ghost")?.textContent ?? null;
    const historyWith = (...commands: string[]) =>
      createHistoryStore({
        load: async () =>
          JSON.stringify({ version: 1, hosts: { local: commands.map((command, i) => ({ command, count: 1, last: i + 1 })) } }),
        save: async () => {},
      });
    /** The ghost is drawn at the next frame: frames run when the test says so. */
    let frames: FrameRequestCallback[] = [];
    beforeEach(() => {
      frames = [];
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
      vi.stubGlobal("cancelAnimationFrame", () => {});
    });
    afterEach(() => vi.unstubAllGlobals());
    const nextFrame = () =>
      act(() => {
        const due = frames;
        frames = [];
        due.forEach((callback) => callback(0));
      });
    /** Types `data` at a prompt, the shell echoing it on the cursor line, and lets a frame go by. */
    const typeAt = (prompt: string, data: string) => {
      act(() => {
        term().line = prompt + data;
        term().type(data);
      });
      nextFrame();
    };
    const key = (k: string, mods: { ctrlKey?: boolean } = {}) => {
      let passed = true;
      act(() => {
        passed = term().keyHandler({ type: "keydown", key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
      });
      return passed;
    };
    const renderView = async (props: Partial<Parameters<typeof TerminalView>[0]> = {}) => {
      backend.start.mockImplementationOnce(() => Promise.resolve(7));
      const view = render(<TerminalView target={{ type: "local" }} active onTitle={() => {}} onExit={() => {}} {...props} />);
      await settle();
      return view;
    };

    it("draws the rest of a known command after the typed prefix and accepts it with Right Arrow, like typing", async () => {
      const onInput = vi.fn();
      const history = historyWith("git status");
      const { container } = await renderView({ history, onInput });
      typeAt("$ ", "git st");
      expect(ghost(container)).toBe("atus");
      expect(key("ArrowRight")).toBe(false);
      expect(backend.write).toHaveBeenLastCalledWith(7, "atus");
      expect(onInput).toHaveBeenLastCalledWith("atus");
      act(() => void (term().line = "$ git status"));
      act(() => term().type("\r"));
      expect(history.recent("local", 1)).toEqual(["git status"]);
    });

    it("draws the ghost once per frame, and never accepts the previous one before it is drawn", async () => {
      const { container } = await renderView({ history: historyWith("git status") });
      typeAt("$ ", "git st");
      expect(ghost(container)).toBe("atus");
      // The next key and its echo arrive before the frame: → still has nothing to accept.
      act(() => {
        term().line = "$ git sta";
        term().type("a");
      });
      backend.write.mockClear();
      expect(key("ArrowRight")).toBe(true);
      expect(backend.write).not.toHaveBeenCalled();
      expect(frames).toHaveLength(1);
      nextFrame();
      expect(ghost(container)).toBe("tus");
    });

    it("accepts the whole suggestion with End and one word with Ctrl+Right", async () => {
      const { container } = await renderView({ history: historyWith("docker compose up -d") });
      typeAt("$ ", "dock");
      expect(key("ArrowRight", { ctrlKey: true })).toBe(false);
      expect(backend.write).toHaveBeenLastCalledWith(7, "er");
      // The shell echoes the accepted word.
      typeAt("$ docker", "");
      expect(ghost(container)).toBe(" compose up -d");
      expect(key("End")).toBe(false);
      expect(backend.write).toHaveBeenLastCalledWith(7, " compose up -d");
    });

    it("leaves Tab and other keys to the shell and pauses suggestions after Tab", async () => {
      const { container } = await renderView({ history: historyWith("git status") });
      typeAt("$ ", "git st");
      expect(key("Tab")).toBe(true);
      expect(key("a")).toBe(true);
      act(() => term().type("\t"));
      nextFrame();
      expect(ghost(container)).toBeNull();
      // Right Arrow without a suggestion reaches the shell.
      expect(key("ArrowRight")).toBe(true);
    });

    describe("with the shell's marks (OSC 133)", () => {
      /** A prompt the screen-reading guesses do not recognise, between the shell's A and B marks. */
      const promptWithMark = (prompt: string) =>
        act(() => {
          term().osc(133, "A");
          term().line = prompt;
          term().osc(133, "B");
        });

      it("ignores a B mark that no prompt mark came before, or that comes while a command runs", async () => {
        const history = historyWith();
        await renderView({ history });
        for (const before of [[], ["A", "C"]]) {
          act(() => before.forEach((mark) => term().osc(133, mark)));
          act(() => {
            term().line = "~/src main ";
            term().osc(133, "B");
          });
          act(() => {
            term().line = "~/src main git checkout";
            term().type("\t");
          });
          act(() => term().type("\r"));
        }
        expect(history.recent("local", 5)).toEqual([]);
      });

      it("records the exact line on screen after Tab completed it", async () => {
        const history = historyWith();
        await renderView({ history });
        promptWithMark("~/src main ");
        typeAt("~/src main ", "git ch");
        act(() => {
          term().line = "~/src main git checkout";
          term().type("\t");
        });
        act(() => term().type("\r"));
        expect(history.recent("local", 5)).toEqual(["git checkout"]);
      });

      it("keeps suggesting after Tab, from the line on screen", async () => {
        const { container } = await renderView({ history: historyWith("git checkout main") });
        promptWithMark("~/src main ");
        typeAt("~/src main ", "git ch");
        act(() => {
          term().line = "~/src main git checkout";
          term().type("\t");
        });
        nextFrame();
        nextFrame();
        expect(ghost(container)).toBe(" main");
      });

      it("tells an empty line from the marks, whatever the prompt looks like", async () => {
        let assist: { lineEmpty?: () => boolean } | null = null;
        await renderView({ registerAssistTarget: (target) => ((assist = target), () => {}) });
        promptWithMark("~/src main ");
        expect(assist!.lineEmpty!()).toBe(true);
        act(() => {
          term().line = "~/src main git status";
          term().type("\x1b[A");
        });
        expect(assist!.lineEmpty!()).toBe(false);
        // Ctrl+U empties the recalled line: without a prompt sign only the marks can tell.
        act(() => {
          term().line = "~/src main ";
          term().type("\x15");
        });
        expect(assist!.lineEmpty!()).toBe(true);
        // The command runs: the line is no longer the one typed at the prompt.
        act(() => term().osc(133, "C"));
        act(() => void (term().line = "~/src main "));
        expect(assist!.lineEmpty!()).toBe(false);
      });
    });

    it("hides suggestions when they are turned off or the cursor is not at the end of the typed text", async () => {
      const { container, rerender } = await renderView({ history: historyWith("git status") });
      act(() => void (term().line = "$ "));
      act(() => term().type("git st")); // not echoed (yet)
      expect(ghost(container)).toBeNull();
      typeAt("$ git st", "");
      act(() => term().type(""));
      expect(ghost(container)).toBe("atus");
      rerender(
        <TerminalView
          target={{ type: "local" }}
          active
          onTitle={() => {}}
          onExit={() => {}}
          history={historyWith("git status")}
          settings={{ ...DEFAULT_SETTINGS, inlineSuggestions: false }}
        />,
      );
      expect(ghost(container)).toBeNull();
    });

    it("records commands sent with Enter, except lines starting with a space", async () => {
      const history = historyWith();
      await renderView({ history });
      typeAt("$ ", "uptime");
      act(() => term().type("\r"));
      typeAt("$ ", " export TOKEN=x");
      act(() => term().type("\r"));
      expect(history.recent("local", 5)).toEqual(["uptime"]);
    });

    it("records a command inserted from the AI chat once it is sent with Enter, never broadcasting it", async () => {
      const history = historyWith();
      const onInput = vi.fn();
      let assist: { insert: (text: string) => void } | null = null;
      await renderView({
        history,
        onInput,
        registerAssistTarget: (target) => {
          assist = target;
          return () => {};
        },
      });
      act(() => void (term().line = "$ "));
      act(() => assist!.insert("du -sh * | sort -h"));
      expect(backend.write).toHaveBeenLastCalledWith(7, "du -sh * | sort -h");
      expect(onInput).not.toHaveBeenCalled();
      expect(history.recent("local", 5)).toEqual([]);
      act(() => term().type("\r"));
      expect(history.recent("local", 5)).toEqual(["du -sh * | sort -h"]);
    });

    it("runs a command from the AI chat: clears what was typed, sends it with Enter and records it", async () => {
      const history = historyWith();
      const onInput = vi.fn();
      let assist: { run: (text: string) => boolean } | null = null;
      await renderView({ history, onInput, registerAssistTarget: (target) => ((assist = target), () => {}) });
      typeAt("$ ", "half typ");
      act(() => term().type("\t")); // the line is no longer known
      let ran = false;
      act(() => void (ran = assist!.run("uptime")));
      expect(ran).toBe(true);
      expect(backend.write).toHaveBeenLastCalledWith(7, "\x05\x15uptime\r");
      expect(history.recent("local", 5)).toEqual(["uptime"]);
      // Only the user's own typing reached onInput (multi-execution, macros).
      expect(onInput).toHaveBeenCalledTimes(2);
    });

    it("clears the line with Ctrl+End and Ctrl+Home before running a command in a local Windows shell", async () => {
      const history = historyWith();
      let assist: { run: (text: string) => boolean } | null = null;
      backend.start.mockImplementationOnce(() => Promise.resolve(7));
      render(
        <PlatformContext.Provider value="windows">
          <TerminalView
            target={{ type: "local" }}
            active
            onTitle={() => {}}
            onExit={() => {}}
            history={history}
            registerAssistTarget={(target) => ((assist = target), () => {})}
          />
        </PlatformContext.Provider>,
      );
      await settle();
      act(() => void assist!.run('Select-String -Path * -Pattern "192.168.2"'));
      expect(backend.write).toHaveBeenLastCalledWith(7, '\x1b[1;5F\x1b[1;5HSelect-String -Path * -Pattern "192.168.2"\r');
      expect(history.recent("local", 5)).toEqual(['Select-String -Path * -Pattern "192.168.2"']);
    });

    it("refuses to run a command at a password prompt or in a full-screen program", async () => {
      const history = historyWith();
      let assist: { run: (text: string) => boolean } | null = null;
      await renderView({ history, registerAssistTarget: (target) => ((assist = target), () => {}) });
      backend.write.mockClear();
      act(() => void (term().line = "[sudo] password for jorge: "));
      expect(assist!.run("uptime")).toBe(false);
      act(() => void (term().line = "$ "));
      act(() => void (term().bufferType = "alternate"));
      expect(assist!.run("uptime")).toBe(false);
      expect(backend.write).not.toHaveBeenCalled();
      expect(history.recent("local", 5)).toEqual([]);
    });

    it("tells whether the command line is empty, for drops (S4)", async () => {
      let assist: { lineEmpty?: () => boolean } | null = null;
      await renderView({ registerAssistTarget: (target) => ((assist = target), () => {}) });
      act(() => void (term().line = "$ "));
      expect(assist!.lineEmpty!()).toBe(true);
      typeAt("$ ", "ls");
      expect(assist!.lineEmpty!()).toBe(false);
      typeAt("$ ", "\r");
      act(() => void (term().line = "$ "));
      expect(assist!.lineEmpty!()).toBe(true);
      act(() => void (term().line = "[sudo] password for jorge: "));
      expect(assist!.lineEmpty!()).toBe(false);
      act(() => void (term().line = "$ "));
      act(() => void (term().bufferType = "alternate"));
      expect(assist!.lineEmpty!()).toBe(false);
    });

    it("reads an uncertain line from the screen: empty after Ctrl+L or arrows, not after a recalled command", async () => {
      let assist: { lineEmpty?: () => boolean } | null = null;
      await renderView({ registerAssistTarget: (target) => ((assist = target), () => {}) });
      /** A key that changes nothing visible, the screen showing `screen` afterwards. */
      const press = (data: string, screen: string) =>
        act(() => {
          term().line = screen;
          term().type(data);
        });
      press("\x0c", "me@box:~$ "); // Ctrl+L: the screen is cleared, the line stays empty
      expect(assist!.lineEmpty!()).toBe(true);
      press("\x1b[D", "me@box:~$ "); // Left on an empty line
      expect(assist!.lineEmpty!()).toBe(true);
      press("\x1b[A", "me@box:~$ git status"); // Up recalls a command
      expect(assist!.lineEmpty!()).toBe(false);
    });

    it("refuses to run a command with line breaks or control characters", async () => {
      let assist: { run: (text: string) => boolean } | null = null;
      await renderView({ registerAssistTarget: (target) => ((assist = target), () => {}) });
      act(() => void (term().line = "$ "));
      backend.write.mockClear();
      for (const text of ["ls\nrm -rf ~", "ls\r", "vim\x1b:!id\r", "a\x03b", "x\u2028y", "\x9b2J"]) {
        expect(assist!.run(text), JSON.stringify(text)).toBe(false);
      }
      expect(backend.write).not.toHaveBeenCalled();
    });

    it("never records nor suggests at a password prompt", async () => {
      const history = historyWith("hunter2-is-not-a-command");
      const { container } = await renderView({ history });
      act(() => void (term().line = "[sudo] password for jorge: "));
      act(() => term().type("hunter2"));
      expect(ghost(container)).toBeNull();
      act(() => term().type("\r"));
      expect(history.recent("local", 5)).toEqual(["hunter2-is-not-a-command"]);
    });

    it("never records nor suggests in full-screen programs", async () => {
      const history = historyWith("git status");
      const { container } = await renderView({ history });
      act(() => void (term().bufferType = "alternate"));
      typeAt("", "git st");
      expect(ghost(container)).toBeNull();
      act(() => term().type(":wq\r"));
      expect(history.recent("local", 5)).toEqual(["git status"]);
    });

    it("does not record commands other panes broadcast to this one", async () => {
      const history = historyWith();
      let write: (data: string) => void = () => {};
      await renderView({ history, registerWriter: (w) => ((write = w), () => {}) });
      act(() => write("uptime\r"));
      expect(backend.write).toHaveBeenLastCalledWith(7, "uptime\r");
      expect(history.recent("local", 5)).toEqual([]);
    });

    describe("AI completion seam", () => {
      afterEach(() => vi.useRealTimers());
      const aiOn = { ...DEFAULT_SETTINGS, aiSuggestions: true, aiHistoryContext: 2 };

      it("asks the AI only when the history has nothing, after a pause, and shows its answer", async () => {
        vi.useFakeTimers();
        const aiSuggest = vi.fn(async ({ line }: { line: string }) => `${line} -o wide`);
        backend.start.mockImplementationOnce(() => Promise.resolve(7));
        const history = historyWith("ls -la", "kubectl apply -f x.yaml");
        const { container } = render(
          <TerminalView target={{ type: "local" }} active onTitle={() => {}} onExit={() => {}} history={history} settings={aiOn} aiSuggest={aiSuggest} />,
        );
        await act(() => vi.advanceTimersByTimeAsync(10));
        typeAt("$ ", "ls");
        await act(() => vi.advanceTimersByTimeAsync(1000));
        expect(aiSuggest).not.toHaveBeenCalled();
        act(() => term().type("\x15"));
        typeAt("$ ", "kubectl get p");
        await act(() => vi.advanceTimersByTimeAsync(200));
        typeAt("$ kubectl get p", "o");
        await act(() => vi.advanceTimersByTimeAsync(399));
        expect(aiSuggest).not.toHaveBeenCalled();
        await act(() => vi.advanceTimersByTimeAsync(1));
        expect(aiSuggest).toHaveBeenCalledTimes(1);
        expect(aiSuggest).toHaveBeenCalledWith({
          line: "kubectl get po",
          hostKey: "local",
          cwd: null,
          history: ["ls -la", "kubectl apply -f x.yaml"],
        });
        // The answer arrives, then the next frame (faked with the timers here) draws it.
        await act(() => vi.advanceTimersByTimeAsync(16));
        expect(ghost(container)).toBe(" -o wide");
      });

      it("never sends nor records what is typed at a password prompt in another language", async () => {
        vi.useFakeTimers();
        const aiSuggest = vi.fn(async ({ line }: { line: string }) => `${line}x`);
        backend.start.mockImplementationOnce(() => Promise.resolve(7));
        const history = historyWith();
        render(
          <TerminalView target={{ type: "local" }} active onTitle={() => {}} onExit={() => {}} history={history} settings={aiOn} aiSuggest={aiSuggest} />,
        );
        await act(() => vi.advanceTimersByTimeAsync(10));
        for (const prompt of ["[sudo] contraseña para jorge: ", "[sudo] jorge 的密码："]) {
          act(() => void (term().line = prompt));
          act(() => term().type("hunter2"));
          await act(() => vi.advanceTimersByTimeAsync(1000));
          act(() => term().type("\r"));
        }
        expect(aiSuggest).not.toHaveBeenCalled();
        expect(history.recent("local", 5)).toEqual([]);
      });

      it("never sends a line typed with a leading space (kept out of history) to the AI", async () => {
        vi.useFakeTimers();
        const aiSuggest = vi.fn(async ({ line }: { line: string }) => `${line}x`);
        backend.start.mockImplementationOnce(() => Promise.resolve(7));
        render(
          <TerminalView target={{ type: "local" }} active onTitle={() => {}} onExit={() => {}} history={historyWith()} settings={aiOn} aiSuggest={aiSuggest} />,
        );
        await act(() => vi.advanceTimersByTimeAsync(10));
        typeAt("$ ", " export TOKEN=abc");
        await act(() => vi.advanceTimersByTimeAsync(1000));
        expect(aiSuggest).not.toHaveBeenCalled();
      });

      it("ignores an answer that arrives after the line changed, and never asks when AI suggestions are off", async () => {
        vi.useFakeTimers();
        let answer: (text: string) => void = () => {};
        const aiSuggest = vi.fn(() => new Promise<string | null>((resolve) => (answer = resolve)));
        backend.start.mockImplementationOnce(() => Promise.resolve(7));
        const { container, rerender } = render(
          <TerminalView target={{ type: "local" }} active onTitle={() => {}} onExit={() => {}} history={historyWith()} settings={aiOn} aiSuggest={aiSuggest} />,
        );
        await act(() => vi.advanceTimersByTimeAsync(10));
        typeAt("$ ", "terraform pl");
        await act(() => vi.advanceTimersByTimeAsync(400));
        typeAt("$ terraform pl", "a");
        await act(async () => answer("terraform plan -out=tf.plan"));
        expect(ghost(container)).toBeNull();
        rerender(
          <TerminalView target={{ type: "local" }} active onTitle={() => {}} onExit={() => {}} settings={DEFAULT_SETTINGS} aiSuggest={aiSuggest} />,
        );
        aiSuggest.mockClear();
        typeAt("$ terraform pla", "n");
        await act(() => vi.advanceTimersByTimeAsync(1000));
        expect(aiSuggest).not.toHaveBeenCalled();
      });
    });
  });

  describe("terminal sharing", () => {
    const shared = async () => {
      let emit: (event: unknown) => void = () => {};
      backend.start.mockImplementation((_options, onEvent) => {
        emit = onEvent as (event: unknown) => void;
        return Promise.resolve(5);
      });
      let pane: import("../share/sharePane").SharePane | null = null;
      const onExit = vi.fn();
      render(
        <TerminalView
          target={{ type: "local" }}
          active
          onTitle={() => {}}
          onExit={onExit}
          registerSharePane={(p) => ((pane = p), () => {})}
        />,
      );
      await vi.waitFor(() => expect(backend.start).toHaveBeenCalled());
      return { emit: (event: unknown) => act(async () => emit(event)), pane: () => pane!, onExit };
    };

    it("learns its tap and output numbers without taking them for the end of the session", async () => {
      const { emit, pane, onExit } = await shared();
      expect(pane().tap()).toBeNull();
      await emit({ event: "tap", data: 42 });
      await emit({ event: "sharedOutput", data: { data: "hello", seq: 3 } });
      expect(onExit).not.toHaveBeenCalled();
      expect(pane().tap()).toBe(42);
      expect(lastTerm().written).toContain("hello");
      expect(lastTerm().written).not.toContain("42");
    });

    it("serializes the screen and the chosen history, saying which output they cover", async () => {
      const { emit, pane } = await shared();
      await emit({ event: "tap", data: 1 });
      await emit({ event: "sharedOutput", data: { data: "abc", seq: 7 } });
      lastTerm().line = "$ ";
      await expect(pane().snapshot(1000)).resolves.toEqual({
        coversSeq: 7,
        screen: "SCREEN:$ ",
        full: expect.stringMatching(/^FULL\(1000\):.*abc/),
      });
      await expect(pane().snapshot("screen")).resolves.toEqual({ coversSeq: 7, screen: null, full: "SCREEN:$ " });
    });

    it("types a viewer's keys into the session without reporting or recording them as the user's", async () => {
      const onInput = vi.fn();
      const onCommand = vi.fn();
      let pane: import("../share/sharePane").SharePane | null = null;
      backend.start.mockImplementation(() => Promise.resolve(9));
      render(
        <TerminalView
          target={{ type: "local" }}
          active
          onTitle={() => {}}
          onExit={() => {}}
          onInput={onInput}
          onCommand={onCommand}
          registerSharePane={(p) => ((pane = p), () => {})}
        />,
      );
      await vi.waitFor(() => expect(backend.start).toHaveBeenCalled());
      await act(async () => {});
      const before = pane!.sharerTypedAt();
      pane!.inject("ls\r");
      expect(backend.write).toHaveBeenCalledWith(9, "ls\r");
      expect(onInput).not.toHaveBeenCalled();
      expect(onCommand).not.toHaveBeenCalled();
      expect(pane!.sharerTypedAt()).toBe(before);
      lastTerm().type("x");
      expect(pane!.sharerTypedAt()).toBeGreaterThan(before);
    });
  });
});
