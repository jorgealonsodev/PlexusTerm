// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "./useSettings";
import { DEFAULT_SETTINGS } from "./settings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

beforeEach(() => mockedInvoke.mockReset());

describe("useSettings", () => {
  it("loads the saved settings", async () => {
    mockedInvoke.mockResolvedValueOnce('{"fontSize":20}');
    const { result } = renderHook(() => useSettings());
    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
    await waitFor(() => expect(result.current.settings.fontSize).toBe(20));
    expect(mockedInvoke).toHaveBeenCalledWith("settings_load");
  });

  it("keeps the defaults when loading fails", async () => {
    mockedInvoke.mockRejectedValueOnce("io error");
    const { result } = renderHook(() => useSettings());
    await act(() => Promise.resolve());
    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("saves every change, clamped, and keeps it over a late load", async () => {
    let finishLoad: (json: string | null) => void = () => {};
    mockedInvoke.mockImplementation((cmd: string) =>
      cmd === "settings_load" ? new Promise((resolve) => (finishLoad = resolve)) : Promise.resolve(),
    );
    const { result } = renderHook(() => useSettings());
    act(() => result.current.update({ fontSize: 50, copyOnSelect: false }));
    expect(result.current.settings).toEqual({ ...DEFAULT_SETTINGS, fontSize: 32, copyOnSelect: false });
    await act(async () => finishLoad('{"fontSize":10}'));
    expect(result.current.settings.fontSize).toBe(32);
    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith("settings_save", {
        contents: expect.stringContaining('"fontSize": 32'),
      }),
    );
  });
});
