import { invoke } from "@tauri-apps/api/core";
import { ArrowDown, ArrowUp, Cpu, HardDrive, MemoryStick, Users, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  computeStats,
  formatBytes,
  formatPercent,
  formatRate,
  type MonitorSample,
  type MonitorSnapshot,
  type MonitorStats,
} from "./monitorStats";
import "./RemoteMonitorBar.css";

/** Time between the end of one sample and the start of the next. */
export const POLL_INTERVAL_MS = 3000;

type View = { kind: "loading" } | { kind: "unavailable" } | { kind: "stats"; stats: MonitorStats };

interface RemoteMonitorBarProps {
  /** The SSH session of the pane; `null` while connecting or after it ended. */
  sessionId: number | null;
  /** The pane is visible; hidden panes are not polled. */
  active: boolean;
}

function Item({ icon: Icon, title, value }: { icon: LucideIcon; title: string; value: string }) {
  return (
    <span className="remote-monitor__item" title={title}>
      <Icon size={13} aria-hidden="true" />
      {value}
    </span>
  );
}

/**
 * Tools > Remote monitor (S3): CPU, memory, root disk, network and users of the server of
 * an SSH pane, sampled over its existing connection every few seconds.
 */
export function RemoteMonitorBar({ sessionId, active }: RemoteMonitorBarProps) {
  const [view, setView] = useState<View>({ kind: "loading" });

  // A new or ended session must not keep showing the previous server's numbers.
  useEffect(() => setView({ kind: "loading" }), [sessionId]);

  useEffect(() => {
    if (sessionId === null || !active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let prev: { snapshot: MonitorSnapshot; at: number } | null = null;

    const poll = async () => {
      try {
        const sample = await invoke<MonitorSample>("monitor_sample", { sessionId });
        if (stopped) return;
        if (sample.status === "ok") {
          const at = Date.now();
          setView({ kind: "stats", stats: computeStats(prev?.snapshot ?? null, sample, prev ? at - prev.at : 0) });
          prev = { snapshot: sample, at };
        } else {
          prev = null;
          setView({ kind: "unavailable" });
        }
      } catch {
        if (stopped) return;
        prev = null;
        setView({ kind: "unavailable" });
      }
      // Scheduled only after the answer, so requests never overlap.
      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [sessionId, active]);

  return (
    <div className="remote-monitor" role="status" aria-label="Remote monitor">
      {view.kind === "loading" && <span className="remote-monitor__note">Monitoring…</span>}
      {view.kind === "unavailable" && (
        <span className="remote-monitor__note remote-monitor__note--warn">Monitoring unavailable</span>
      )}
      {view.kind === "stats" && (
        <>
          <Item icon={Cpu} title="CPU usage" value={formatPercent(view.stats.cpuPercent)} />
          <Item
            icon={MemoryStick}
            title="Memory used / total"
            value={`${formatBytes(view.stats.memUsed)} / ${formatBytes(view.stats.memTotal)}`}
          />
          <Item
            icon={HardDrive}
            title="Root disk used / total"
            value={`${formatBytes(view.stats.diskUsed)} / ${formatBytes(view.stats.diskTotal)}`}
          />
          <Item icon={ArrowDown} title="Network received" value={formatRate(view.stats.rxRate)} />
          <Item icon={ArrowUp} title="Network sent" value={formatRate(view.stats.txRate)} />
          <Item icon={Users} title="Logged-in users" value={String(view.stats.users)} />
        </>
      )}
    </div>
  );
}
