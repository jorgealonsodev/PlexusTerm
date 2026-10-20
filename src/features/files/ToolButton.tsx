import type { MouseEvent } from "react";
import type { LucideIcon } from "lucide-react";

interface ToolButtonProps {
  icon: LucideIcon;
  /** Its accessible name and tooltip. */
  label: string;
  disabled?: boolean;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}

/** An action of a file list's toolbar, shown as an icon named by its tooltip. */
export function ToolButton({ icon: Icon, label, disabled, onClick }: ToolButtonProps) {
  return (
    <button type="button" className="btn btn--small sftp__tool" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <Icon size={14} aria-hidden="true" />
    </button>
  );
}
