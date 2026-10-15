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
// Only the keyring commands reach `invoke` here (the backend is mocked): a keyring is available.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => true) }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    parser = { registerOscHandler: () => ({ dispose() {} }) };
    loadAddon() {}
    attachCustomKeyEventHandler() {}
    open() {}
    write() {}
    focus() {}
    dispose() {}
    onData = () => ({ dispose() {} });
    onResize = () => ({ dispose() {} });
    onTitleChange = () => ({ dispose() {} });
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));

import { TerminalView } from "./TerminalView";

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
        storage: { action: "remember", sessionId: "s1", label: "NexusTerm: u@10.0.0.1:22" },
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
});
