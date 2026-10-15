/** Mirrors the Rust `SshError` enum serialized with `#[serde(tag = "kind")]`. */
export type SshError =
  | { kind: "unknownHost"; host: string; fingerprint: string }
  | { kind: "hostKeyChanged"; host: string; fingerprint: string; line: number }
  | { kind: "authFailed" }
  | { kind: "unknownSession"; id: number }
  | { kind: "connection"; message: string };

/** Normalizes whatever `invoke` rejected with into an `SshError`. */
export function toSshError(err: unknown): SshError {
  if (typeof err === "object" && err !== null && typeof (err as { kind?: unknown }).kind === "string") {
    return err as SshError;
  }
  return { kind: "connection", message: String(err) };
}

export function describeSshError(err: SshError): string {
  switch (err.kind) {
    case "unknownHost":
      return `The authenticity of host ${err.host} can't be established. Fingerprint: ${err.fingerprint}`;
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
    case "unknownSession":
      return `Session ${err.id} is no longer open.`;
    case "connection":
      return err.message;
  }
}
