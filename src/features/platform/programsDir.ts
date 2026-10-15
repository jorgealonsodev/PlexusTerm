import type { Platform } from "./usePlatform";

/** Where the system keeps installed programs: the starting folder of "choose a program" pickers. */
export function programsDir(platform: Platform): string {
  switch (platform) {
    case "windows":
      return "C:\\Program Files";
    case "macos":
      return "/Applications";
    default:
      return "/usr/bin";
  }
}
