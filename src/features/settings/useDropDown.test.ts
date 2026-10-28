// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../../i18n/i18n";
import { describeDropDownError, useDropDown } from "./useDropDown";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockedInvoke.mockReset();
  mockedInvoke.mockResolvedValue(null);
});

const calls = () => mockedInvoke.mock.calls.filter(([cmd]) => cmd === "dropdown_set").map(([, args]) => args);

describe("useDropDown", () => {
  it("sets the shortcut once the settings are loaded, and again on each change", async () => {
    const { rerender } = renderHook(({ shortcut, height, loaded }) => useDropDown(shortcut, height, loaded), {
      initialProps: { shortcut: "Ctrl+Alt+K", height: 50, loaded: false },
    });
    expect(calls()).toEqual([]);
    rerender({ shortcut: "Ctrl+Alt+K", height: 50, loaded: true });
    rerender({ shortcut: "Ctrl+Alt+K", height: 70, loaded: true });
    rerender({ shortcut: "", height: 70, loaded: true });
    await act(() => Promise.resolve());
    expect(calls()).toEqual([
      { shortcut: "Ctrl+Alt+K", height: 50 },
      { shortcut: "Ctrl+Alt+K", height: 70 },
      { shortcut: "", height: 70 },
    ]);
  });

  it("asks nothing of the system while the drop-down stays off", async () => {
    const { rerender } = renderHook(({ height }) => useDropDown("", height, true), { initialProps: { height: 50 } });
    rerender({ height: 60 });
    await act(() => Promise.resolve());
    expect(calls()).toEqual([]);
  });

  it("gives the reason a shortcut could not be set, and clears it when one is", async () => {
    mockedInvoke.mockRejectedValueOnce({ kind: "register", detail: "already grabbed" });
    const { result, rerender } = renderHook(({ shortcut }) => useDropDown(shortcut, 50, true), {
      initialProps: { shortcut: "Ctrl+Alt+K" },
    });
    await waitFor(() => expect(result.current).toEqual({ kind: "register", detail: "already grabbed" }));
    rerender({ shortcut: "Ctrl+Alt+J" });
    await waitFor(() => expect(result.current).toBeNull());
  });
});

describe("describeDropDownError", () => {
  it("explains each reason", () => {
    expect(describeDropDownError({ kind: "wayland" }, t)).toBe(t("settings.general.dropDownWayland"));
    expect(describeDropDownError({ kind: "invalid", detail: "K" }, t)).toBe(t("settings.shortcuts.invalid"));
    expect(describeDropDownError({ kind: "register", detail: "busy" }, t)).toBe(
      t("settings.general.dropDownFailed", { error: "busy" }),
    );
    expect(describeDropDownError("boom", t)).toBe(t("settings.general.dropDownFailed", { error: "boom" }));
  });
});
