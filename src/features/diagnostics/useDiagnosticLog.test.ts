// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { HEARTBEAT_MS, useDiagnosticLog } from "./useDiagnosticLog";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.useFakeTimers();
  mockedInvoke.mockReset();
  mockedInvoke.mockResolvedValue(null);
});
afterEach(() => vi.useRealTimers());

const calls = (command: string) => mockedInvoke.mock.calls.filter(([name]) => name === command);

describe("useDiagnosticLog", () => {
  it("waits for the settings before configuring anything", () => {
    renderHook(() => useDiagnosticLog(false, true, "/logs"));
    vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("turns the log off when Settings leave it off, and sends no heartbeat", () => {
    renderHook(() => useDiagnosticLog(true, false, "/logs"));
    vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    expect(mockedInvoke.mock.calls).toEqual([["diag_log_configure", { enabled: false, dir: "" }]]);
  });

  it("turns the log on in the chosen folder and beats every second until turned off", () => {
    const { rerender } = renderHook(({ on }) => useDiagnosticLog(true, on, "/logs"), { initialProps: { on: true } });
    expect(calls("diag_log_configure")).toEqual([["diag_log_configure", { enabled: true, dir: "/logs" }]]);
    vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    expect(calls("diag_heartbeat")).toHaveLength(3);
    expect(calls("diag_heartbeat")[0][1]).toEqual({ lateMs: expect.any(Number) });

    rerender({ on: false });
    vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    expect(calls("diag_heartbeat")).toHaveLength(3);
    expect(calls("diag_log_configure").slice(-1)[0]).toEqual(["diag_log_configure", { enabled: false, dir: "" }]);
  });

  it("notes the graphics renderer once the log is on", async () => {
    renderHook(() => useDiagnosticLog(true, true, "", false));
    await vi.waitFor(() => expect(calls("diag_log")).toHaveLength(1));
    expect(calls("diag_log")[0][1]).toEqual({ level: "info", message: expect.stringMatching(/^graphics: .*, GPU acceleration off$/) });
  });

  it("reports no lateness while the window is hidden, whose timers are slowed on purpose", () => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    try {
      renderHook(() => useDiagnosticLog(true, true, ""));
      vi.advanceTimersByTime(HEARTBEAT_MS * 2);
      expect(calls("diag_heartbeat").map(([, args]) => args)).toEqual([{ lateMs: 0 }, { lateMs: 0 }]);
    } finally {
      delete (document as { hidden?: boolean }).hidden;
    }
  });

  it("logs uncaught errors while on", () => {
    renderHook(() => useDiagnosticLog(true, true, ""));
    window.dispatchEvent(new ErrorEvent("error", { message: "boom", filename: "app.js", lineno: 3, colno: 7 }));
    expect(calls("diag_log")).toContainEqual(["diag_log", { level: "error", message: "boom at app.js:3:7" }]);
  });
});
