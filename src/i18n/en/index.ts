import { ai } from "./ai";
import { app } from "./app";
import { common } from "./common";
import { macros } from "./macros";
import { sessions } from "./sessions";
import { settings } from "./settings";
import { share } from "./share";
import { sftp } from "./sftp";
import { terminal } from "./terminal";
import { tools } from "./tools";
import { tunnels } from "./tunnels";

/** The English catalogue: the source of every other language's keys. */
export const en = { common, app, sessions, terminal, sftp, tools, tunnels, macros, settings, ai, share };
