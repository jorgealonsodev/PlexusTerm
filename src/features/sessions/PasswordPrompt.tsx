import { useState, type FormEvent } from "react";

interface PasswordPromptProps {
  label: string;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

export function PasswordPrompt({ label, onSubmit, onCancel }: PasswordPromptProps) {
  const [password, setPassword] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(password);
  };
  return (
    <div className="overlay" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <form className="dialog" onSubmit={submit} aria-labelledby="pw-title">
        <h2 id="pw-title">Password for {label}</h2>
        <label className="field">
          Password
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary">
            Connect
          </button>
        </div>
      </form>
    </div>
  );
}
