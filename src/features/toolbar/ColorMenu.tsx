import { useT } from "../../i18n/i18n";
import { ContextMenu } from "../menu/ContextMenu";
import { TOOLBAR_COLORS } from "./toolbarColor";

interface ColorMenuProps {
  x: number;
  y: number;
  /** The colour in use, or null for none. */
  current: string | null;
  onPick: (color: string | null) => void;
  onClose: () => void;
}

/** A menu of colours (the toolbar's, a tab's): the preset ones, a custom one, or none. */
export function ColorMenu({ x, y, current, onPick, onClose }: ColorMenuProps) {
  const t = useT();
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
        { label: t("app.toolbarColor.none"), onSelect: () => onPick(null), disabled: !current },
      ]}
    >
      <label className="context-menu__custom">
        {t("app.toolbarColor.custom")}
        <input
          type="color"
          aria-label={t("app.toolbarColor.custom")}
          value={current ?? "#2e86de"}
          onChange={(e) => onPick(e.target.value.toLowerCase())}
        />
      </label>
    </ContextMenu>
  );
}
