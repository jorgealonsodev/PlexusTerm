// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  start: vi.fn((_options?: unknown, _onEvent?: unknown) => new Promise<number>(() => {})),
  write: vi.fn(() => Promise.resolve()),
  resize: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
}));

vi.mock("./backend", () => ({ backendFor: () => backend }));
const clipboard = vi.hoisted(() => ({ readText: vi.fn(async () => ""), writeText: vi.fn(async () => {}) }));
vi.mock("./clipboard", () => clipboard);
// Only the keyring commands reach `invoke` here (the backend is mocked): a keyring is available.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => true) }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(async () => "/tmp/session.log") }));

/** Every fake xterm created, newest last. */
const terms = vi.hoisted(() => [] as FakeTerminal[]);
interface FakeTerminal {
  options: { fontSize?: number; fontFamily?: string; theme?: { background?: string } };
  keyHandler: (e: Partial<KeyboardEvent>) => boolean;
  paste: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  selectAll: ReturnType<typeof vi.fn>;
  written: string[];
  /** The cursor line on screen; the cursor sits at its end. */
  line: string;
  bufferType: "normal" | "alternate";
  /** What xterm's onData would emit for typed keys. */
  type: (data: string) => void;
}

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options: { fontSize?: number; fontFamily?: string; theme?: { background?: string } };
    parser = { registerOscHandler: () => ({ dispose() {} }) };
    keyHandler: (e: unknown) => boolean = () => true;
    paste = vi.fn();
    clear = vi.fn();
    selectAll = vi.fn();
    line = "";
    bufferType = "normal";
    get buffer() {
      const line = this.line;
      const row = {
        isWrapped: false,
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
    dataHandlers: ((data: string) => void)[] = [];
    type(data: string) {
      this.dataHandlers.forEach((handler) => handler(data));
    }
    constructor(options: { fontSize?: number; fontFamily?: string; theme?: { background?: string } }) {
      this.options = { ...options };
      terms.push(this as unknown as FakeTerminal);
    }
    loadAddon() {}
    attachCustomKeyEventHandler(handler: (e: unknown) => boolean) {
      this.keyHandler = handler;
    }
    open() {}
    written: string[] = [];
    write(text: string) {
      this.written.push(text);
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
    onResize = () => ({ dispose() {} });
    onTitleChange = () => ({ dispose() {} });
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
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
import { TerminalView } from "./TerminalView";
import { DEFAULT_SETTINGS } from "../settings/settings";
import { createHistoryStore } from "../history/historyStore";

const lastTerm = () => terms[terms.length - 1];

globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TerminalView", () => {
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
    const rightClick = (container: HTMLElement, mods: { ctrlKey?: boolean } = {}) =>
      fireEvent.contextMenu(container.querySelector(".terminal-host")!, { clientX: 5, clientY: 6, ...mods });

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
    /** Types `data` at a prompt, the shell echoing it on the cursor line. */
    const typeAt = (prompt: string, data: string) =>
      act(() => {
        term().line = prompt + data;
        term().type(data);
      });
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
      expect(ghost(container)).toBeNull();
      // Right Arrow without a suggestion reaches the shell.
      expect(key("ArrowRight")).toBe(true);
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
});
