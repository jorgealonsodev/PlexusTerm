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
  return (
    `This host already has ${otherKnownKeys.join(", ")} key(s) recorded in known_hosts. ` +
    "The server may have changed its key type, or someone may be intercepting the connection."
  );
}

export function describeSshError(err: SshError): string {
  switch (err.kind) {
    case "unknownHost": {
      const text = `The authenticity of host ${err.host} can't be established. Fingerprint: ${err.fingerprint}`;
      return err.otherKnownKeys.length ? `${text}\r\n${otherKeysWarning(err.otherKnownKeys)}` : text;
    }
    case "hostKeyChanged":
      return [
        "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!",
        `The host key for ${err.host} is now ${err.fingerprint},`,
        `which does not match line ${err.line} of ~/.ssh/known_hosts.`,
        "Someone could be intercepting the connection. If the change is expected,",
        "remove the old entry (ssh-keygen -R <host>) and connect again.",
      ].join("\r\n");
    case "authFailed":
      return "Authentication failed.";
    case "secretMissing":
      return "No saved password was found for this session.";
    case "unknownSession":
      return `Session ${err.id} is no longer open.`;
    case "connection":
      return err.message;
    case "hop":
      return `via ${err.name} (jump host ${err.hop}): ${describeSshError(err.error)}`;
  }
}
