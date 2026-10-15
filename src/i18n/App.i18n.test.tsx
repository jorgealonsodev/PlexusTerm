// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "../App";
import { DEFAULT_SETTINGS } from "../features/settings/settings";
import { setLocale } from "./i18n";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("../features/terminal/TerminalView", () => ({ TerminalView: () => <div data-testid="terminal" /> }));

const languages = vi.spyOn(navigator, "languages", "get");

afterEach(() => {
  cleanup();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async () => null);
  languages.mockReturnValue(["en-US"]);
  act(() => setLocale("en"));
});

const saved = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "settings_save")
    .map(([, args]) => JSON.parse((args as { contents: string }).contents));

async function renderApp(settings: Partial<typeof DEFAULT_SETTINGS> = {}) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) =>
    cmd === "settings_load" ? JSON.stringify({ ...DEFAULT_SETTINGS, ...settings }) : null,
  );
  render(<App />);
  await act(() => Promise.resolve());
  await act(() => Promise.resolve());
}

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe("Interface language (S3, S4)", () => {
  it("follows the system language by default, and English when it is not supported", async () => {
    languages.mockReturnValue(["sv-SE", "ja-JP"]);
    await renderApp();
    expect(document.documentElement.lang).toBe("ja");
    cleanup();
    languages.mockReturnValue(["sv-SE"]);
    await renderApp();
    expect(document.documentElement.lang).toBe("en");
  });

  it("uses the language chosen in Settings, right to left for Arabic", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "ar" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    await flush();
    expect(saved().slice(-1)[0].language).toBe("ar");
  });

  it("has untranslated rescue buttons that switch to English or the system language at once", async () => {
    languages.mockReturnValue(["de-DE"]);
    await renderApp({ language: "ko" });
    expect(document.documentElement.lang).toBe("ko");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(document.documentElement.lang).toBe("en");
    await flush();
    expect(saved().slice(-1)[0].language).toBe("en");
    fireEvent.click(screen.getByRole("button", { name: "System language" }));
    expect(document.documentElement.lang).toBe("de");
    await flush();
    expect(saved().slice(-1)[0].language).toBe("system");
  });
});
