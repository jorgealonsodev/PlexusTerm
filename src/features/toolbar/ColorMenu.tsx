import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useT } from "../../i18n/i18n";
import { ContextMenu } from "../menu/ContextMenu";
import { usePlatform } from "../platform/usePlatform";
import { CustomColorDialog } from "./CustomColorDialog";
import { TOOLBAR_COLORS } from "./toolbarColor";

interface ColorMenuProps {
  x: number;
  y: number;
  /** The colour in use, or null for none. */
  current: string | null;
  onPick: (color: string | null) => void;
  onClose: () => void;
}

type EyeDropperWindow = Window & { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } };

/**
 * How this system picks a colour anywhere on the screen: the webview's EyeDropper (Windows), the
 * desktop portal (Linux), or none.
 */
function screenPicker(platform: string): (() => Promise<string | null>) | null {
  const EyeDropper = (window as EyeDropperWindow).EyeDropper;
  if (EyeDropper) return () => new EyeDropper().open().then((r) => r.sRGBHex, () => null);
  if (platform === "linux") return () => invoke<string | null>("screen_color_pick");
  return null;
}

/** A menu of colours (the toolbar's, a tab's): the preset ones, a custom one, or none. */
export function ColorMenu({ x, y, current, onPick, onClose }: ColorMenuProps) {
  const t = useT();
  const platform = usePlatform();
  const [custom, setCustom] = useState(false);
  if (custom) {
    return (
      <CustomColorDialog
        initial={current}
        pickFromScreen={screenPicker(platform)}
        onAccept={(color) => {
          onPick(color);
          onClose();
        }}
        onCancel={onClose}
      />
    );
  }
  return (
    <ContextMenu
      x={x}
      y={y}
      onClose={onClose}
      items={[
        ...TOOLBAR_COLORS.map(([name, color]) => ({
          label: t(`app.toolbarColor.${name}`),
          swatch: color,
          onSelect: () => onPick(color),
        })),
        { separator: true as const },
        { label: t("app.toolbarColor.customMenu"), onSelect: () => setCustom(true), keepOpen: true },
        { label: t("app.toolbarColor.none"), onSelect: () => onPick(null), disabled: !current },
      ]}
    />
  );
}
