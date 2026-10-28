import { isProxyCommand } from "../ssh/quickConnect";
import { IMPORT_ROOT, type ImportedSession, type ParsedImport } from "./iniImport";
import { MAX_JUMPS } from "./library";

/** Every host of an OpenSSH config file goes in this folder. */
export const SSH_CONFIG_FOLDER = `${IMPORT_ROOT}/SSH config`;

/** Options read from the file; every other option is ignored. */
const OPTIONS = ["hostname", "user", "port", "identityfile", "proxyjump", "proxycommand"] as const;
type Option = (typeof OPTIONS)[number];

/**
 * The options of a block, plus `proxy`: which of ProxyJump and ProxyCommand came first, the one
 * ssh uses (the later one never takes effect).
 */
type Options = Partial<Record<Option, string>> & { proxy?: "proxyjump" | "proxycommand" };

interface Block {
  /** `null` for a Match block, which this import never applies. */
  patterns: string[] | null;
  options: Options;
}

const WILDCARD = /[*?]/;

/** `Key value`, `Key=value` or `Key = value`; a value may be wrapped in double quotes. */
function splitLine(line: string): [string, string] | null {
  const match = /^(\S+?)\s*(?:=\s*|\s+)(.*)$/.exec(line);
  if (!match) return null;
  return [match[1].toLowerCase(), match[2].trim()];
}

/** The first argument of a value, without its quotes. */
function firstArgument(value: string): string {
  if (value.startsWith('"')) {
    const end = value.indexOf('"', 1);
    return end < 0 ? value.slice(1) : value.slice(1, end);
  }
  return value.split(/\s+/)[0] ?? "";
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

/** Like ssh: a negated pattern that matches excludes the block, otherwise any positive match applies it. */
function blockMatches(patterns: string[], alias: string): boolean {
  let matched = false;
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) {
      if (globToRegExp(pattern.slice(1)).test(alias)) return false;
    } else if (globToRegExp(pattern).test(alias)) {
      matched = true;
    }
  }
  return matched;
}

function parsePort(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) return 22;
  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : 22;
}

/** A ProxyJump hop: `[user@]host[:port]`, `[user@][IPv6]:port` or `ssh://` with either. */
interface Hop {
  user?: string;
  host: string;
  port?: number;
}

function parseHop(text: string): Hop | null {
  const match = /^(?:ssh:\/\/)?(?:([^@\s]+)@)?(?:\[([^\]\s]+)\]|([^:@\s[\]]+))(?::(\d+))?$/.exec(text);
  if (!match) return null;
  const [, user, bracketed, plain, portText] = match;
  const port = portText === undefined ? undefined : Number(portText);
  if (port !== undefined && !(port >= 1 && port <= 65535)) return null;
  return { ...(user ? { user } : {}), host: bracketed ?? plain, ...(port ? { port } : {}) };
}

/**
 * Reads the hosts of an OpenSSH client config (`~/.ssh/config`). Each concrete `Host` alias becomes
 * a session; wildcard blocks and options before the first `Host` give it defaults, the first value
 * of each option winning as in ssh. `Include` and `Match` are not followed; they are counted in `skipped`.
 */
export function parseSshConfig(text: string): ParsedImport {
  const blocks: Block[] = [{ patterns: ["*"], options: {} }];
  const aliases: string[] = [];
  const skipped: Record<string, number> = {};
  const skip = (reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = splitLine(line);
    if (!parts) continue;
    const [key, value] = parts;
    if (key === "host") {
      const patterns = value.split(/\s+/).map((p) => p.replace(/^"|"$/g, "")).filter(Boolean);
      blocks.push({ patterns, options: {} });
      for (const pattern of patterns) {
        if (!WILDCARD.test(pattern) && !pattern.startsWith("!") && !aliases.includes(pattern)) aliases.push(pattern);
      }
    } else if (key === "match") {
      skip("match");
      blocks.push({ patterns: null, options: {} });
    } else if (key === "include") {
      skip("include");
    } else if ((OPTIONS as readonly string[]).includes(key)) {
      const options = blocks[blocks.length - 1].options;
      // ProxyCommand is the rest of the line, as ssh hands it to the shell.
      options[key as Option] ??= key === "proxycommand" ? value : firstArgument(value);
      if (key === "proxyjump" || key === "proxycommand") options.proxy ??= key;
    }
  }

  const resolve = (alias: string): Options => {
    const resolved: Options = {};
    for (const block of blocks) {
      if (!block.patterns || !blockMatches(block.patterns, alias)) continue;
      for (const option of OPTIONS) resolved[option] ??= block.options[option];
      resolved.proxy ??= block.options.proxy;
    }
    return resolved;
  };

  /** Jump host sessions made for hops that are not hosts of the file, by hop text. */
  const hopSessions = new Map<string, ImportedSession>();
  /**
   * The name of the session a ProxyJump hop goes through: the host of the file it names when the
   * hop asks for nothing else, otherwise a session made for the hop (the settings of the host it
   * names, with the hop's user and port). Null when the hop cannot be read.
   */
  const jumpName = (text: string, alias: string): string | null => {
    if (aliases.includes(text)) return text === alias ? null : text;
    const hop = parseHop(text);
    if (!hop) return null;
    const options = resolve(hop.host);
    const username = hop.user ?? options.user ?? "";
    const port = hop.port ?? parsePort(options.port);
    if (aliases.includes(hop.host)) {
      const same = username === (options.user ?? "") && port === parsePort(options.port);
      if (same) return hop.host === alias ? null : hop.host;
    }
    if (!hopSessions.has(text)) {
      hopSessions.set(text, {
        kind: "ssh",
        name: text,
        folder: SSH_CONFIG_FOLDER,
        host: (options.hostname ?? hop.host).replace(/%h/g, hop.host),
        port,
        username,
        ...(options.identityfile ? { auth: { method: "key", path: options.identityfile.replace(/%d/g, "~") } } : {}),
      });
    }
    return text;
  };

  const sessions: ImportedSession[] = [];
  for (const alias of aliases) {
    const options = resolve(alias);
    const session: ImportedSession = {
      kind: "ssh",
      name: alias,
      folder: SSH_CONFIG_FOLDER,
      host: (options.hostname ?? alias).replace(/%h/g, alias),
      port: parsePort(options.port),
      username: options.user ?? "",
    };
    if (options.identityfile) {
      session.auth = { method: "key", path: options.identityfile.replace(/%d/g, "~") };
    }
    const command = options.proxy === "proxycommand" ? options.proxycommand : undefined;
    if (command && command.toLowerCase() !== "none" && session.kind === "ssh") {
      if (isProxyCommand(command)) session.proxyCommand = command;
      else skip("proxyCommand");
    }
    const jump = options.proxy === "proxyjump" ? options.proxyjump : undefined;
    if (jump && jump.toLowerCase() !== "none" && session.kind === "ssh") {
      const hops = jump.split(",").map((hop) => hop.trim()).filter(Boolean);
      const names = hops.length <= MAX_JUMPS ? hops.map((hop) => jumpName(hop, alias)) : [null];
      if (names.every((name): name is string => name !== null)) session.jumps = names;
      else skip("jump");
    }
    sessions.push(session);
  }
  return { sessions: [...sessions, ...hopSessions.values()], skipped };
}
