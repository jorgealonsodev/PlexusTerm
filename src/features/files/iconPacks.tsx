import type { SftpEntry } from "../sftp/sftpClient";
import { FileTypeIcon } from "./FileTypeIcon";
import { FlatFileIcon } from "./FlatFileIcon";
import {
  MATERIAL_FILE,
  MATERIAL_FOLDER,
  MATERIAL_ICONS,
  MATERIAL_LIGHT_MAPS,
  MATERIAL_MAPS,
  MATERIAL_OPEN_FOLDER,
} from "./materialIcons.generated";

/** The file icon packs Settings offer: Material Icon Theme, VS Code's Seti, plain line icons, or the classic emoji ones. */
export const ICON_PACKS = ["material", "seti", "lines", "classic"] as const;

/** The first icons of PlexusTerm's file lists. */
const CLASSIC_ICONS: Record<SftpEntry["kind"], string> = { dir: "📁", file: "📄", symlink: "🔗" };
export type IconPack = (typeof ICON_PACKS)[number];
export const isIconPack = (value: unknown): value is IconPack => (ICON_PACKS as readonly unknown[]).includes(value);

/** The pack of the plain file lists and the one of DEV mode's trees, as Settings choose. */
export interface FileIconPacks {
  list: IconPack;
  tree: IconPack;
}

export const DEFAULT_ICON_PACKS: FileIconPacks = { list: "material", tree: "seti" };

type Maps = {
  extensions: Record<string, string>;
  names: Record<string, string>;
  folders: Record<string, string>;
  openFolders: Record<string, string>;
};

function lookup(maps: Maps, name: string, kind: SftpEntry["kind"], open: boolean): string | undefined {
  const lower = name.toLowerCase();
  if (kind === "dir") {
    const folders = open ? maps.openFolders : maps.folders;
    return folders[lower] ?? folders[lower.replace(/^[._]/, "")];
  }
  if (maps.names[lower]) return maps.names[lower];
  // The longest extension first: "app.d.ts" is a declaration file before a TypeScript one.
  for (let dot = lower.indexOf("."); dot !== -1; dot = lower.indexOf(".", dot + 1)) {
    const icon = maps.extensions[lower.slice(dot + 1)];
    if (icon && dot > 0) return icon;
  }
  return undefined;
}

/** The Material icon of an entry for the dark and the light colour schemes. */
export function materialIconFor(name: string, kind: SftpEntry["kind"], open = false): { dark: string; light: string } {
  const folder = open ? MATERIAL_OPEN_FOLDER : MATERIAL_FOLDER;
  const dark = lookup(MATERIAL_MAPS, name, kind, open) ?? (kind === "dir" ? folder : MATERIAL_FILE);
  return { dark, light: lookup(MATERIAL_LIGHT_MAPS, name, kind, open) ?? dark };
}

function MaterialIcon({ name, kind, open }: { name: string; kind: SftpEntry["kind"]; open: boolean }) {
  const { dark, light } = materialIconFor(name, kind, open);
  return (
    <span className="sftp-row__icon material-icon" data-icon={dark} aria-hidden="true">
      <img className="material-icon__dark" src={MATERIAL_ICONS[dark]} alt="" draggable={false} />
      {light !== dark && <img className="material-icon__light" src={MATERIAL_ICONS[light]} alt="" draggable={false} />}
    </span>
  );
}

/** An entry's icon in the given pack; `open` draws an expanded folder where the pack has one. */
export function EntryIcon({ pack, name, kind, open = false }: { pack: IconPack; name: string; kind: SftpEntry["kind"]; open?: boolean }) {
  if (pack === "seti") return <FileTypeIcon name={name} kind={kind} open={open} />;
  if (pack === "classic") {
    return (
      <span className="sftp-row__icon" data-icon={kind} aria-hidden="true">
        {CLASSIC_ICONS[kind]}
      </span>
    );
  }
  if (pack === "lines") {
    return (
      <span className="sftp-row__icon">
        <FlatFileIcon name={name} kind={kind} />
      </span>
    );
  }
  return <MaterialIcon name={name} kind={kind} open={open} />;
}
