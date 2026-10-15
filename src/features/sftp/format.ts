/** Display helpers shared by the SFTP browser and its dialogs. */

export function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}

export const formatDate = (secs: number) =>
  new Date(secs * 1000).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
