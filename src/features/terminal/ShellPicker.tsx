import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useT } from "../../i18n/i18n";
import { programsDir } from "../platform/programsDir";
import { usePlatform } from "../platform/usePlatform";
import { useShells } from "../platform/useShells";
import { MAX_LOCAL_SHELL_LENGTH } from "../settings/settings";
import { HelpTip } from "../sidebar/HelpTip";

/** Value of the "Other…" option: never a program path. */
const OTHER = "\u0000other";

interface ShellPickerProps {
  /** Prefix of the field ids. */
  id: string;
  label: string;
  /** Its explanation, behind a "?" next to the label. */
  help?: string;
  /** The chosen program; "" runs the system default shell. */
  program: string;
  /** Its arguments as typed. */
  args: string;
  onChange: (program: string, args: string) => void;
}

/**
 * Chooses the shell of local terminals: the system default, one of the shells found on this
 * machine, or any other program (typed or chosen with Browse…), with its arguments.
 */
export function ShellPicker({ id, label, help, program, args, onChange }: ShellPickerProps) {
  const t = useT();
  const platform = usePlatform();
  const shells = useShells();
  const available = shells?.available ?? [];
  const chosen = program.trim();
  /** Set when the user picks "Other…", so the program field stays while it is still empty. */
  const [otherPicked, setOtherPicked] = useState(false);
  const other = otherPicked || (chosen !== "" && !available.some((shell) => shell.program === chosen));

  const choose = (value: string) => {
    setOtherPicked(value === OTHER);
    if (value === OTHER) return;
    // The system default takes no arguments of its own.
    onChange(value, value ? args : "");
  };

  const browse = async () => {
    try {
      const picked = await open({
        title: t("settings.terminal.chooseShell"),
        multiple: false,
        directory: false,
        defaultPath: programsDir(platform),
      });
      if (typeof picked === "string") onChange(picked, args);
    } catch {
      // No file picker (e.g. outside Tauri): the field can still be typed.
    }
  };

  return (
    <>
      <label className="field">
        <span className="setting-title">
          {label} {help && <HelpTip text={help} />}
        </span>
        <select value={other ? OTHER : chosen} onChange={(e) => choose(e.target.value)}>
          <option value="">
            {shells
              ? t("settings.terminal.shellDefaultNamed", { name: shells.default.name })
              : t("settings.terminal.shellDefault")}
          </option>
          {available.map((shell) => (
            <option key={shell.program} value={shell.program}>
              {`${shell.name} — ${shell.program}`}
            </option>
          ))}
          <option value={OTHER}>{t("settings.terminal.shellOther")}</option>
        </select>
      </label>
      {other && (
        <div className="field">
          <label htmlFor={`${id}-program`}>{t("settings.terminal.shellProgram")}</label>
          <div className="form-row field__picker">
            <input
              id={`${id}-program`}
              value={program}
              maxLength={MAX_LOCAL_SHELL_LENGTH}
              spellCheck={false}
              onChange={(e) => onChange(e.target.value, args)}
            />
            <button type="button" className="btn" onClick={() => void browse()}>
              {t("common.browse")}
            </button>
          </div>
        </div>
      )}
      {(other || chosen !== "") && (
        <label className="field">
          {t("settings.terminal.shellArgs")}
          <input
            value={args}
            maxLength={MAX_LOCAL_SHELL_LENGTH}
            spellCheck={false}
            onChange={(e) => onChange(program, e.target.value)}
          />
        </label>
      )}
    </>
  );
}
