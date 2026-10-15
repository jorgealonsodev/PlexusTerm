/** What the backend runs on the server when a session does not override it (S17.2). */
export const DEFAULT_SERVER_COMMAND = "mosh-server new -s -c 256 -l LANG=en_US.UTF-8";

/** Mosh fields as typed. */
export interface MoshForm {
  /** Saved SSH session whose login starts the server. */
  sshSessionId: string;
  /** Empty means {@link DEFAULT_SERVER_COMMAND}. */
  serverCommand: string;
}

export const emptyMoshForm: MoshForm = { sshSessionId: "", serverCommand: "" };
