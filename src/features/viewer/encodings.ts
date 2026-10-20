import type { AppKey } from "../../i18n/catalogs";

/** The encodings a file can be read and saved with: the backend's ids (localfs.rs). */
export const ENCODINGS = [
  { id: "utf-8", name: "UTF-8", region: "unicode" },
  { id: "utf-8-bom", name: "UTF-8 BOM", region: "unicode" },
  { id: "utf-16le", name: "UTF-16 LE", region: "unicode" },
  { id: "utf-16be", name: "UTF-16 BE", region: "unicode" },
  { id: "windows-1252", name: "Windows 1252", region: "western" },
  { id: "iso-8859-15", name: "ISO 8859-15", region: "western" },
  { id: "windows-1250", name: "Windows 1250", region: "centralEuropean" },
  { id: "iso-8859-2", name: "ISO 8859-2", region: "centralEuropean" },
  { id: "windows-1251", name: "Windows 1251", region: "cyrillic" },
  { id: "koi8-r", name: "KOI8-R", region: "cyrillic" },
  { id: "shift_jis", name: "Shift JIS", region: "japanese" },
  { id: "euc-jp", name: "EUC-JP", region: "japanese" },
  { id: "gbk", name: "GBK", region: "chineseSimplified" },
  { id: "big5", name: "Big5", region: "chineseTraditional" },
  { id: "euc-kr", name: "EUC-KR", region: "korean" },
] as const;

export type EncodingRegion = (typeof ENCODINGS)[number]["region"];

/** The i18n key of an encoding's script or region. */
export const regionKey = (region: EncodingRegion) => `app.viewer.encodingRegion.${region}` as AppKey;

/** The short name the status bar shows; UTF-8 with a BOM has its own words, unknown ids show as they are. */
export function encodingName(id: string, t: (key: AppKey) => string): string {
  if (id === "utf-8-bom") return t("app.viewer.utf8Bom");
  return ENCODINGS.find((e) => e.id === id)?.name ?? id;
}
