import { invoke } from "@tauri-apps/api/core";

/**
 * Latency diagnostics, only when the app runs with `PLEXUS_LATENCY_LOG=<folder>`: the moments a
 * key and its echo pass through the terminal, appended to `<folder>/js.log` as
 * `<mark> <µs since the epoch> <bytes>`. Only times and sizes, never the text.
 */
let path: string | null = null;
let lines: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

void invoke<string | null>("diag_latency_log")
  .then((p) => (path = p ?? null))
  .catch(() => {});

const flush = () => {
  flushTimer = null;
  if (!path || lines.length === 0) return;
  const contents = `${lines.join("\n")}\n`;
  lines = [];
  void invoke("append_text_file", { path, contents }).catch(() => {});
};

export function latencyMark(mark: string, bytes = 0) {
  if (!path) return;
  lines.push(`${mark} ${Math.round((performance.timeOrigin + performance.now()) * 1000)} ${bytes}`);
  flushTimer ??= setTimeout(flush, 500);
}

/** Marks the next painted frame. */
export function latencyFrame() {
  if (!path) return;
  requestAnimationFrame(() => latencyMark("F"));
}
