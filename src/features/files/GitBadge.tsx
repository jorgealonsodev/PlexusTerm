import { useT } from "../../i18n/i18n";
import type { Decoration } from "./gitStatus";

/** Classes for an entry's name: the status colour, struck through when deleted. */
export const gitNameClass = (decoration: Decoration | null) =>
  decoration ? ` git--${decoration.color}${decoration.strike ? " git--strike" : ""}` : "";

/** The status letter at the right of a row (a dot on a folder coloured by its contents), with its tooltip. */
export function GitBadge({ decoration }: { decoration: Decoration }) {
  const t = useT();
  const label = t(`sftp.git.${decoration.label}`);
  return (
    <span className={`sftp-row__git git--${decoration.color}`} title={label} aria-label={label}>
      {decoration.letter ?? "●"}
    </span>
  );
}
