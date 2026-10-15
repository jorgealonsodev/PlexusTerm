import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { toTarget, type SavedSession } from "../sessions/library";
import { PasswordPrompt } from "../sessions/PasswordPrompt";
import { HostKeyPrompt } from "../ssh/HostKeyPrompt";
import { toSshError } from "../ssh/sshErrors";
import type { Tunnel, TunnelStatus } from "./tunnels";

type Prompt =
  | { kind: "password"; label: string; resolve: (password: string | null) => void }
  | {
      kind: "hostKey";
      host: string;
      fingerprint: string;
      otherKnownKeys: string[];
      resolve: (trust: boolean) => void;
    };

const isActive = (status: TunnelStatus) => status.state === "starting" || status.state === "running";

/**
 * Starts and stops tunnels through the backend. Password sessions ask for the
 * password (never stored) and unknown hosts ask for trust, like terminal tabs.
 */
export function useTunnelLauncher(
  sessions: SavedSession[],
  statusOf: (id: string) => TunnelStatus,
  reportError: (id: string, message: string) => void,
) {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  const askPassword = (label: string) =>
    new Promise<string | null>((resolve) => setPrompt({ kind: "password", label, resolve }));

  const start = useCallback(
    async (tunnel: Tunnel) => {
      const session = sessionsRef.current.find((s) => s.id === tunnel.sessionId);
      if (!session) {
        reportError(tunnel.id, "Its saved session no longer exists; edit the tunnel to choose another one.");
        return;
      }
      let password: string | undefined;
      if (session.auth.method === "password") {
        const answer = await askPassword(`${session.username}@${session.host}`);
        if (answer === null) return;
        password = answer;
      }
      const { type: _local, ...target } = toTarget(session, password);
      let trustedFingerprint: string | null = null;
      for (;;) {
        try {
          await invoke("tunnel_start", { tunnel, target, trustedFingerprint });
          return;
        } catch (raw) {
          const err = toSshError(raw);
          // Every other failure is already shown as the tunnel's error status.
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
          if (!trust) return;
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
        onCancel={() => answer(prompt.resolve, null)}
        onSubmit={(password) => answer(prompt.resolve, password)}
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
