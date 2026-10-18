import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

/**
 * Whether notifications may be shown, asked once per run. The webview's own Notification API is not
 * dependable in WebKitGTK (Linux) and WebView2 (Windows), so the Tauri notification plugin shows
 * them through the operating system.
 */
let allowed: Promise<boolean> | null = null;

const askPermission = async () => (await isPermissionGranted()) || (await requestPermission()) === "granted";

/** Shows a desktop notification; does nothing when it is not allowed or cannot be shown. */
export async function showSystemNotification(title: string, body: string): Promise<void> {
  allowed ??= askPermission().catch(() => false);
  try {
    if (await allowed) sendNotification({ title, body });
  } catch {
    // No notification service (e.g. a minimal Linux desktop): the tab still shows the mark.
  }
}
