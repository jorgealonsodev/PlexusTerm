import type { AppCatalog } from "../catalogs";
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

/** The Arabic catalogue (shown right to left). */
export const ar: AppCatalog = { common, app, sessions, terminal, sftp, tools, tunnels, macros, settings, ai, share };
