import { t } from "../../i18n/i18n";

/** Mirrors the Rust `SshError` enum serialized with `#[serde(tag = "kind")]`. */
export type SshError =
  | { kind: "unknownHost"; host: string; fingerprint: string; otherKnownKeys: string[] }
  | { kind: "hostKeyChanged"; host: string; fingerprint: string; line: number }
  | { kind: "authFailed" }
  | { kind: "secretMissing" }
  | { kind: "unknownSession"; id: number }
  | { kind: "connection"; message: string }
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
    case "hop":
      return t("sessions.sshError.hop", { name: err.name, hop: err.hop, error: describeSshError(err.error) });
  }
}
