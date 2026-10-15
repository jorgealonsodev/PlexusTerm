import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { chainTarget, collectLogins, hopLabel, patchJump, type PasswordAnswer } from "../sessions/jumpHosts";
import { isSshSession, resolveChain, type LibrarySession } from "../sessions/library";
import { savedPasswordRejected, shouldAskAgain, storageFor } from "../sessions/passwordFlow";
import { PasswordPrompt } from "../sessions/PasswordPrompt";
import type { SshAuth } from "../sessions/types";
import { HostKeyPrompt } from "../ssh/HostKeyPrompt";
import { t } from "../../i18n/i18n";
import { toSshError, type SshError } from "../ssh/sshErrors";
import type { Tunnel, TunnelStatus } from "./tunnels";

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
      /** Set when the host is a jump host. */
      via?: string;
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
 * Starts and stops tunnels through the backend, going through the jump hosts of the
 * tunnel's session. Password logins use the password saved in the keyring, or ask for
 * it (optionally saving it), and unknown hosts ask for trust, like terminal tabs.
 * `tunnels` is the current saved list: a tunnel deleted or changed while a
 * prompt was open is not started.
 */
export function useTunnelLauncher(
  /** Every saved session: the tunnel's own and its jump hosts. */
  sessions: LibrarySession[],
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
    const current = tunnelsRef.current.find((saved) => saved.id === tunnel.id);
    return current !== undefined && sameForward(current, tunnel);
  };

  const askPassword = (label: string, rememberInitially: boolean) =>
    new Promise<PasswordAnswer | null>((resolve) =>
      setPrompt({ kind: "password", label, rememberInitially, resolve }),
    );

  const start = useCallback(
    async (tunnel: Tunnel) => {
      const all = sessionsRef.current;
      const session = all.find((s) => s.id === tunnel.sessionId);
      if (!session || !isSshSession(session)) {
        reportError(tunnel.id, t("tunnels.launcher.sessionGone"));
        return;
      }
      const chain = resolveChain({ sessions: all }, session);
      if (!chain.ok) {
        reportError(tunnel.id, chain.error);
        return;
      }
      const hops = [...chain.jumps, session];
      const last = hops.length - 1;
      // Password hops connect first (the backend tries the agent and default keys); a password
      // the server still needs is asked after connecting, one hop at a time.
      const logins = await collectLogins(hops);
      if (logins === null || !stillWanted(tunnel)) return;
      let target = chainTarget(hops, logins);

      /**
       * Asks for hop `index` after its saved password was missing (unticked, like a first login)
       * or rejected (ticked); false when cancelled.
       */
      const retypePassword = async (index: number, rejected: boolean) => {
        const answer = await askPassword(hopLabel(hops, index), rejected);
        if (answer === null || !stillWanted(tunnel)) return false;
        const auth: SshAuth = { method: "password", password: answer.password };
        const storage = storageFor(hops[index], answer.remember, rejected);
        if (index === last) target = { ...target, auth, storage };
        else target = { ...target, jumps: patchJump(target.jumps ?? [], index, { auth, storage }) };
        return true;
      };
      /** Asks whether to trust an unknown host key; false when refused or the tunnel changed. */
      const trustHost = async (err: Extract<SshError, { kind: "unknownHost" }>, via?: string) => {
        const trust = await new Promise<boolean>((resolve) =>
          setPrompt({
            kind: "hostKey",
            host: err.host,
            fingerprint: err.fingerprint,
            otherKnownKeys: err.otherKnownKeys,
            via,
            resolve,
          }),
        );
        return trust && stillWanted(tunnel);
      };

      let trustedFingerprint: string | null = null;
      for (;;) {
        try {
          const { type: _ssh, storage, ...where } = target;
          await invoke("tunnel_start", { tunnel, target: where, trustedFingerprint, storage: storage ?? null });
          return;
        } catch (raw) {
          // A rejection without a `kind` (IPC or argument errors) never reached the
          // tunnel manager, so nothing else will show it.
          if (!isRecordedByBackend(raw)) {
            reportError(tunnel.id, t("tunnels.launcher.startFailed", { error: String(raw) }));
            return;
          }
          const err = toSshError(raw);
          // Every failure is already shown as the tunnel's error status; only the ones a
          // prompt can fix are retried. `alreadyRunning` means the backend already reported
          // it starting or running.
          if (err.kind === "hop") {
            const index = err.hop - 1;
            const jump = target.jumps?.[index];
            if (!jump || index >= last) return;
            // The saved password of a jump host is missing or outdated: ask for it and retry.
            if (shouldAskAgain(jump.auth, err.error)) {
              if (!(await retypePassword(index, savedPasswordRejected(err.error)))) return;
              continue;
            }
            if (err.error.kind !== "unknownHost" || jump.trustedFingerprint) return;
            if (!(await trustHost(err.error, hopLabel(hops, index)))) return;
            target = { ...target, jumps: patchJump(target.jumps ?? [], index, { trustedFingerprint: err.error.fingerprint }) };
            continue;
          }
          // The saved password is missing or outdated: ask for it and retry (once, typed).
          if (shouldAskAgain(target.auth, err)) {
            if (!(await retypePassword(last, savedPasswordRejected(err)))) return;
            continue;
          }
          if (err.kind !== "unknownHost" || trustedFingerprint !== null) return;
          if (!(await trustHost(err))) return;
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
        via={prompt.via}
        onCancel={() => answer(prompt.resolve, false)}
        onTrust={() => answer(prompt.resolve, true)}
      />
    );
  }

  return { start, stop, startAll, stopAll, isActive, dialog };
}
