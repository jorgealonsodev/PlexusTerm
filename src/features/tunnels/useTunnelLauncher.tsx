import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { toTarget, type SavedSession } from "../sessions/library";
import { shouldAskAgain, storageFor } from "../sessions/passwordFlow";
import { PasswordPrompt } from "../sessions/PasswordPrompt";
import { secretExists } from "../sessions/secrets";
import type { PasswordStorage, SshAuth } from "../sessions/types";
import { HostKeyPrompt } from "../ssh/HostKeyPrompt";
import { toSshError } from "../ssh/sshErrors";
import type { Tunnel, TunnelStatus } from "./tunnels";

interface PasswordAnswer {
  password: string;
  /** Undefined while the keyring state is unknown: the saved password is left as it is. */
  remember: boolean | undefined;
}

type Prompt =
  | {
      kind: "password";
      label: string;
      /** Whether "Save password in the system keyring" starts ticked. */
      rememberInitially: boolean;
      resolve: (answer: PasswordAnswer | null) => void;
    }
  | {
      kind: "hostKey";
      host: string;
      fingerprint: string;
      otherKnownKeys: string[];
      resolve: (trust: boolean) => void;
    };

const isActive = (status: TunnelStatus) => status.state === "starting" || status.state === "running";

/** True when both describe the same forward through the same session (the name does not matter). */
const sameForward = (a: Tunnel, b: Tunnel) =>
  a.type === b.type &&
  a.sessionId === b.sessionId &&
  a.listenHost === b.listenHost &&
  a.listenPort === b.listenPort &&
  a.destHost === b.destHost &&
  a.destPort === b.destPort;

/** Errors the tunnel manager returns after recording them as the tunnel's error status. */
const isRecordedByBackend = (raw: unknown) =>
  typeof raw === "object" && raw !== null && typeof (raw as { kind?: unknown }).kind === "string";

/**
 * Starts and stops tunnels through the backend. Password sessions use the password
 * saved in the keyring, or ask for it (optionally saving it), and unknown hosts ask
 * for trust, like terminal tabs.
 * `tunnels` is the current saved list: a tunnel deleted or changed while a
 * prompt was open is not started.
 */
export function useTunnelLauncher(
  sessions: SavedSession[],
  statusOf: (id: string) => TunnelStatus,
  reportError: (id: string, message: string) => void,
  tunnels: Tunnel[],
) {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const tunnelsRef = useRef(tunnels);
  tunnelsRef.current = tunnels;

  /** Whether `tunnel` is still saved as it was when the start began. */
  const stillWanted = (tunnel: Tunnel) => {
    const current = tunnelsRef.current.find((t) => t.id === tunnel.id);
    return current !== undefined && sameForward(current, tunnel);
  };

  const askPassword = (label: string, rememberInitially: boolean) =>
    new Promise<PasswordAnswer | null>((resolve) =>
      setPrompt({ kind: "password", label, rememberInitially, resolve }),
    );

  const start = useCallback(
    async (tunnel: Tunnel) => {
      const session = sessionsRef.current.find((s) => s.id === tunnel.sessionId);
      if (!session) {
        reportError(tunnel.id, "Its saved session no longer exists; edit the tunnel to choose another one.");
        return;
      }
      const { type: _local, auth: savedAuth, ...where } = toTarget(session);
      const label = `${session.username}@${session.host}`;
      let auth: SshAuth = savedAuth;
      let storage: PasswordStorage | undefined;
      /** Asks for the password; false when the user cancelled or the tunnel changed meanwhile. */
      const typePassword = async (hadSecret: boolean) => {
        const answer = await askPassword(label, hadSecret);
        if (answer === null || !stillWanted(tunnel)) return false;
        auth = { method: "password", password: answer.password };
        storage = storageFor(session, answer.remember, hadSecret);
        return true;
      };
      if (session.auth.method === "password") {
        if (await secretExists(session.id)) {
          if (!stillWanted(tunnel)) return;
          auth = { method: "storedPassword", sessionId: session.id };
        } else if (!(await typePassword(false))) {
          return;
        }
      }
      let trustedFingerprint: string | null = null;
      for (;;) {
        try {
          const target = { ...where, auth };
          await invoke("tunnel_start", { tunnel, target, trustedFingerprint, storage: storage ?? null });
          return;
        } catch (raw) {
          // A rejection without a `kind` (IPC or argument errors) never reached the
          // tunnel manager, so nothing else will show it.
          if (!isRecordedByBackend(raw)) {
            reportError(tunnel.id, `Could not start the tunnel: ${String(raw)}`);
            return;
          }
          const err = toSshError(raw);
          // The saved password is missing or outdated: ask for it and retry (once, typed).
          if (shouldAskAgain(auth, err)) {
            if (!(await typePassword(true))) return;
            continue;
          }
          // Every other failure is already shown as the tunnel's error status;
          // `alreadyRunning` means the backend already reported it starting or running.
          if (err.kind !== "unknownHost" || trustedFingerprint !== null) return;
          const trust = await new Promise<boolean>((resolve) =>
            setPrompt({
              kind: "hostKey",
              host: err.host,
              fingerprint: err.fingerprint,
              otherKnownKeys: err.otherKnownKeys,
              resolve,
            }),
          );
          if (!trust || !stillWanted(tunnel)) return;
          trustedFingerprint = err.fingerprint;
        }
      }
    },
    [reportError],
  );

  const stop = useCallback((id: string) => invoke("tunnel_stop", { id }).catch(() => {}), []);

  /** Starts the tunnels that are not running, one at a time so prompts never overlap. */
  const startAll = useCallback(
    async (tunnels: Tunnel[]) => {
      for (const tunnel of tunnels) {
        if (!isActive(statusOf(tunnel.id))) await start(tunnel);
      }
    },
    [start, statusOf],
  );

  const stopAll = useCallback(
    (tunnels: Tunnel[]) => Promise.all(tunnels.filter((t) => isActive(statusOf(t.id))).map((t) => stop(t.id))),
    [stop, statusOf],
  );

  const answer = <T,>(resolve: (value: T) => void, value: T) => {
    setPrompt(null);
    resolve(value);
  };

  let dialog: ReactNode = null;
  if (prompt?.kind === "password") {
    dialog = (
      <PasswordPrompt
        label={prompt.label}
        remember={{ initial: prompt.rememberInitially }}
        onCancel={() => answer(prompt.resolve, null)}
        onSubmit={(password, remember) => answer(prompt.resolve, { password, remember })}
      />
    );
  } else if (prompt?.kind === "hostKey") {
    dialog = (
      <HostKeyPrompt
        host={prompt.host}
        fingerprint={prompt.fingerprint}
        otherKnownKeys={prompt.otherKnownKeys}
        onCancel={() => answer(prompt.resolve, false)}
        onTrust={() => answer(prompt.resolve, true)}
      />
    );
  }

  return { start, stop, startAll, stopAll, isActive, dialog };
}
