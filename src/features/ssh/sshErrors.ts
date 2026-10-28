import { t } from "../../i18n/i18n";

/** Mirrors the Rust `SshError` enum serialized with `#[serde(tag = "kind")]`. */
export type SshError =
  | { kind: "unknownHost"; host: string; fingerprint: string; otherKnownKeys: string[] }
  | { kind: "hostKeyChanged"; host: string; fingerprint: string; line: number }
  | { kind: "authFailed" }
  | { kind: "secretMissing" }
  | { kind: "unknownSession"; id: number }
  | { kind: "connection"; message: string }
  /**
   * A password or passphrase command gave no usable secret: `code` is its exit code (null when a
   * signal stopped it), `stderr` the first lines of its error output (never what it printed).
   */
  | {
      kind: "passwordCommand";
      purpose: "password" | "passphrase";
      failure: "invalid" | "start" | "exit" | "timeout" | "empty" | "tooLong" | "notText";
      code: number | null;
      stderr: string;
    }
  /** A jump host failed: `hop` is its 1-based position, `error` what went wrong there. */
  | { kind: "hop"; hop: number; name: string; error: SshError };

/** Normalizes whatever `invoke` rejected with into an `SshError`. */
export function toSshError(err: unknown): SshError {
  if (typeof err === "object" && err !== null && typeof (err as { kind?: unknown }).kind === "string") {
    return err as SshError;
  }
  return { kind: "connection", message: String(err) };
}

/** Shown when the server offers a key type that differs from the ones recorded for it. */
export function otherKeysWarning(otherKnownKeys: string[]): string {
  return t("sessions.sshError.otherKeys", { keys: otherKnownKeys.join(", ") });
}

/** How long the backend lets a password command run (`SECRET_COMMAND_TIMEOUT`). */
const COMMAND_TIMEOUT_SECONDS = 30;

function describeCommandFailure(err: Extract<SshError, { kind: "passwordCommand" }>): string {
  const what = t(err.purpose === "passphrase" ? "sessions.passwordCommand.passphrase" : "sessions.passwordCommand.password");
  const failed = (() => {
    switch (err.failure) {
      case "exit":
        return err.code === null
          ? t("sessions.passwordCommand.error.signal", { what })
          : t("sessions.passwordCommand.error.exit", { what, code: err.code });
      case "timeout":
        return t("sessions.passwordCommand.error.timeout", { what, seconds: COMMAND_TIMEOUT_SECONDS });
      default:
        return t(`sessions.passwordCommand.error.${err.failure}` as const, { what });
    }
  })();
  const stderr = err.stderr.split("\n").filter((line) => line.trim() !== "");
  return [failed, ...stderr].join("\r\n");
}

export function describeSshError(err: SshError): string {
  switch (err.kind) {
    case "unknownHost": {
      const text = t("sessions.sshError.unknownHost", { host: err.host, fingerprint: err.fingerprint });
      return err.otherKnownKeys.length ? `${text}\r\n${otherKeysWarning(err.otherKnownKeys)}` : text;
    }
    case "hostKeyChanged":
      return [
        t("sessions.sshError.hostKeyChanged1"),
        t("sessions.sshError.hostKeyChanged2", { host: err.host, fingerprint: err.fingerprint }),
        t("sessions.sshError.hostKeyChanged3", { line: err.line }),
        t("sessions.sshError.hostKeyChanged4"),
        t("sessions.sshError.hostKeyChanged5"),
      ].join("\r\n");
    case "authFailed":
      return t("sessions.sshError.authFailed");
    case "secretMissing":
      return t("sessions.sshError.secretMissing");
    case "unknownSession":
      return t("sessions.sshError.unknownSession", { id: err.id });
    case "connection":
      return err.message;
    case "passwordCommand":
      return describeCommandFailure(err);
    case "hop":
      return t("sessions.sshError.hop", { name: err.name, hop: err.hop, error: describeSshError(err.error) });
  }
}
