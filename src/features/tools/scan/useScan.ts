import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../../i18n/i18n";
import { stopScan, type ScanEvent, type ScanStarter } from "./scanBackend";

export type ScanPhase = "idle" | "running" | "done" | "stopped";

/** Runs one scan at a time: progress, errors, Stop, and stopping the scan on unmount. */
export function useScan(onResult: (event: ScanEvent) => void) {
  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const scanId = useRef<number | null>(null);
  const stopRequested = useRef(false);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const start = useCallback(async (starter: ScanStarter) => {
    setError(null);
    setProgress({ done: 0, total: 0 });
    stopRequested.current = false;
    setPhase("running");
    try {
      const id = await starter((event) => {
        if (event.event === "started") setProgress({ done: 0, total: event.data.total });
        else if (event.event === "progress") setProgress(event.data);
        else if (event.event === "done") {
          setProgress({ done: event.data.done, total: event.data.total });
          setPhase(event.data.cancelled ? "stopped" : "done");
          scanId.current = null;
        } else onResultRef.current(event);
      });
      scanId.current = id;
      if (stopRequested.current) void stopScan(id);
    } catch (err) {
      setError(String(err));
      setPhase("idle");
    }
  }, []);

  const stop = useCallback(() => {
    stopRequested.current = true;
    if (scanId.current !== null) void stopScan(scanId.current);
  }, []);

  useEffect(
    () => () => {
      if (scanId.current !== null) void stopScan(scanId.current);
    },
    [],
  );

  return { phase, progress, error, setError, start, stop };
}

export function progressText(phase: ScanPhase, { done, total }: { done: number; total: number }, found: string) {
  if (phase === "running") return total ? t("tools.scan.scanning", { done, total }) : t("tools.scan.starting");
  if (phase === "done") return t("tools.scan.done", { done, found });
  if (phase === "stopped") return t("tools.scan.stopped", { done, total, found });
  return "";
}
