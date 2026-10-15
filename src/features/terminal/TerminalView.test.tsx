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
    buffer = { active: { length: 0, getLine: () => undefined } };
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
    onData = () => ({ dispose() {} });
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

    it("forgets the saved password when the checkbox is unticked on a missing secret", async () => {
      const box = await rejectFirstStartWith({ kind: "secretMissing" });
      await vi.waitFor(() => expect(box.disabled).toBe(false));
      fireEvent.click(box);
      fireEvent.change(screen.getByLabelText("Password"), { target: { value: "new" } });
      fireEvent.click(screen.getByText("Connect"));
      await vi.waitFor(() => expect(backend.start).toHaveBeenCalledTimes(2));
      expect(backend.start.mock.calls[1][0]).toMatchObject({ storage: { action: "forget", sessionId: "s1" } });
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
});
