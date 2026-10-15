// WebKitGTK refuses navigator.clipboard.readText(), so the clipboard goes through
// the Tauri clipboard plugin (limited to plain text by the app's capabilities).
export { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
