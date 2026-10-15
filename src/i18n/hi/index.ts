import type { AppCatalog } from "../catalogs";
import { ai } from "./ai";
import { app } from "./app";
import { common } from "./common";
import { macros } from "./macros";
import { sessions } from "./sessions";
import { settings } from "./settings";
import { sftp } from "./sftp";
import { terminal } from "./terminal";
import { tools } from "./tools";
import { tunnels } from "./tunnels";

/** The Hindi catalogue. */
export const hi: AppCatalog = { common, app, sessions, terminal, sftp, tools, tunnels, macros, settings, ai };
