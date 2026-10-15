// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  start: vi.fn(() => new Promise<number>(() => {})),
  write: vi.fn(() => Promise.resolve()),
  resize: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
}));

vi.mock("./backend", () => ({ backendFor: () => backend }));
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
});
