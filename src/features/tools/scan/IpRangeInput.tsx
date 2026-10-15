import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { parsePastedRange, type IpRange } from "./ipRange";

const FIELDS: { key: keyof IpRange; label: string }[] = [
  { key: "a", label: "First octet" },
  { key: "b", label: "Second octet" },
  { key: "c", label: "Third octet" },
  { key: "start", label: "Range start" },
  { key: "end", label: "Range end" },
];

interface IpRangeInputProps {
  value: IpRange;
  onChange: (value: IpRange) => void;
  disabled?: boolean;
}

/**
 * `[a] . [b] . [c] . [start] → [end]`: one field per part of the address. Typing a dot or a
 * third digit moves to the next field; pasting an address, a range or a /24 fills them all.
 */
export function IpRangeInput({ value, onChange, disabled }: IpRangeInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const focus = (index: number) => {
    const next = refs.current[index];
    if (next) {
      next.focus();
      next.select();
    }
  };

  const change = (index: number, text: string) => {
    const digits = text.replace(/\D/g, "").slice(0, 3);
    onChange({ ...value, [FIELDS[index].key]: digits });
    if (digits.length === 3) focus(index + 1);
  };

  const keyDown = (index: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "." || (e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length)) {
      if (e.key === ".") e.preventDefault();
      focus(index + 1);
    } else if (e.key === "Backspace" && e.currentTarget.value === "") {
      focus(index - 1);
    }
  };

  const paste = (e: ClipboardEvent<HTMLInputElement>) => {
    const range = parsePastedRange(e.clipboardData.getData("text"));
    if (!range) return;
    e.preventDefault();
    onChange(range);
  };

  return (
    <div className="ip-range" role="group" aria-label="IP address range">
      {FIELDS.map(({ key, label }, index) => (
        <span key={key} className="ip-range__part">
          {index > 0 && <span className="ip-range__sep">{index === 4 ? "→" : "."}</span>}
          <input
            ref={(el) => {
              refs.current[index] = el;
            }}
            className="ip-range__field"
            aria-label={label}
            inputMode="numeric"
            maxLength={3}
            autoFocus={index === 0}
            disabled={disabled}
            value={value[key]}
            onChange={(e) => change(index, e.target.value)}
            onKeyDown={keyDown(index)}
            onPaste={paste}
            onFocus={(e) => e.currentTarget.select()}
          />
        </span>
      ))}
    </div>
  );
}
