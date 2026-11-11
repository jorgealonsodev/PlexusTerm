import { afterEach, describe, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import { listenHere, windowLabel } from "./currentWindow";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

afterEach(() => {
  delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe("currentWindow", () => {
  it("is the main window outside Tauri, and the window Tauri names otherwise", () => {
    expect(windowLabel()).toBe("main");
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { metadata: { currentWebview: { label: "tab-2" } } };
    expect(windowLabel()).toBe("tab-2");
  });

  it("listens only to what is sent to every window or to this one", async () => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { metadata: { currentWebview: { label: "tab-4" } } };
    const handler = () => {};
    await listenHere("open-folder", handler);
    expect(listen).toHaveBeenCalledWith("open-folder", handler, { target: "tab-4" });
  });
});
