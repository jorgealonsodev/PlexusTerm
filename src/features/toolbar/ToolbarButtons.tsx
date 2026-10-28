import { ChevronDown, Wrench, type LucideIcon } from "lucide-react";
import { useT } from "../../i18n/i18n";
import { DropdownMenu } from "../menu/DropdownMenu";
import type { ToolbarAction, ToolbarGroup, ToolbarLayout } from "./toolbarLayout";

/** What a toolbar action shows and does, wherever the layout puts it. */
export interface ToolbarActionSpec {
  /** Its name: the button's label, or the menu item's text. */
  label: string;
  /** The button's tooltip, with its shortcut; the label when absent. */
  title?: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  /** An on/off action: pressed on the bar, ticked in a menu. */
  pressed?: boolean;
  /** Extra classes of its bar button. */
  className?: string;
  /** The bar button shows only its icon. */
  iconOnly?: boolean;
}

/** Each action's spec, or null where it is not offered (Mosh on Windows, DEV column outside DEV mode). */
export type ToolbarSpecs = Record<ToolbarAction, ToolbarActionSpec | null>;

/** A group's name: the one the user gave it, else its default one. */
export function useGroupName() {
  const t = useT();
  return (group: Pick<ToolbarGroup, "id" | "name">) =>
    group.name.trim() ||
    (group.id === "more" ? t("app.toolbar.more") : group.id === "tools" ? t("app.toolbar.tools") : t("settings.toolbar.group"));
}

/** The toolbar's actions and drop-down groups, in the layout's order (the logo and Settings are not part of it). */
export function ToolbarButtons({ layout, specs }: { layout: ToolbarLayout; specs: ToolbarSpecs }) {
  const groupName = useGroupName();
  return (
    <>
      {layout.bar.map((entry) => {
        if (entry.kind === "action") {
          const spec = specs[entry.id];
          return spec && <ActionButton key={entry.id} spec={spec} />;
        }
        const items = entry.items.flatMap((id) => {
          const spec = specs[id];
          return spec
            ? [{ label: spec.label, icon: <spec.icon size={15} />, onSelect: spec.onSelect, disabled: spec.disabled, checked: spec.pressed }]
            : [];
        });
        if (items.length === 0) return null;
        const name = groupName(entry);
        return (
          <DropdownMenu
            key={`group:${entry.id}`}
            title={name}
            items={items}
            button={
              entry.id === "tools" ? (
                <>
                  <Wrench size={16} />
                  <span className="btn__label">{name}</span>
                </>
              ) : (
                <>
                  <span className="btn__label">{name}</span>
                  <ChevronDown size={14} />
                </>
              )
            }
          />
        );
      })}
    </>
  );
}

function ActionButton({ spec }: { spec: ToolbarActionSpec }) {
  const Icon = spec.icon;
  const toggle = spec.pressed !== undefined;
  return (
    <button
      type="button"
      className={`btn btn--icon${spec.pressed ? " btn--pressed" : ""}${spec.className ? ` ${spec.className}` : ""}`}
      aria-pressed={toggle ? spec.pressed : undefined}
      aria-label={spec.iconOnly ? spec.label : undefined}
      title={spec.title ?? spec.label}
      disabled={spec.disabled}
      onClick={spec.onSelect}
    >
      <Icon size={16} />
      {!spec.iconOnly && <span className="btn__label">{spec.label}</span>}
    </button>
  );
}
