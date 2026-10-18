import { afterEach, describe, expect, it, vi } from "vitest";

const plugin = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(async () => false),
  requestPermission: vi.fn(async () => "granted" as NotificationPermission),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-notification", () => plugin);

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

const load = async () => (await import("./systemNotification")).showSystemNotification;

describe("showSystemNotification", () => {
  it("asks for permission once, then shows the notification through the Tauri plugin", async () => {
    const show = await load();
    await show("Local terminal", "Claude is waiting for your input");
    await show("Local terminal", "Done");
    expect(plugin.requestPermission).toHaveBeenCalledTimes(1);
    expect(plugin.sendNotification).toHaveBeenCalledWith({ title: "Local terminal", body: "Claude is waiting for your input" });
    expect(plugin.sendNotification).toHaveBeenCalledTimes(2);
  });

  it("shows nothing when the permission is refused, and never throws", async () => {
    plugin.requestPermission.mockResolvedValueOnce("denied");
    const show = await load();
    await expect(show("t", "b")).resolves.toBeUndefined();
    expect(plugin.sendNotification).not.toHaveBeenCalled();
    plugin.isPermissionGranted.mockRejectedValueOnce(new Error("no plugin"));
    const again = await load();
    await expect(again("t", "b")).resolves.toBeUndefined();
  });
});
