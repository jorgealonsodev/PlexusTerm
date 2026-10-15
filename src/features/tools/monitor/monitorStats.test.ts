import { describe, expect, it } from "vitest";
import { computeStats, formatBytes, formatPercent, formatRate, type MonitorSnapshot } from "./monitorStats";

const GiB = 1024 ** 3;

const snapshot = (patch: Partial<MonitorSnapshot> = {}): MonitorSnapshot => ({
  cpuTotal: 1000,
  cpuIdle: 800,
  memTotal: 8 * GiB,
  memAvailable: 6 * GiB,
  diskTotal: 100 * GiB,
  diskUsed: 40 * GiB,
  netRx: 10_000,
  netTx: 5_000,
  users: 2,
  ...patch,
});

describe("computeStats", () => {
  it("shows memory, disk and users from one sample, but no CPU or network rates yet", () => {
    expect(computeStats(null, snapshot(), 0)).toEqual({
      cpuPercent: null,
      memUsed: 2 * GiB,
      memTotal: 8 * GiB,
      diskUsed: 40 * GiB,
      diskTotal: 100 * GiB,
      rxRate: null,
      txRate: null,
      users: 2,
    });
  });

  it("computes CPU % and network rates from two consecutive samples", () => {
    const prev = snapshot();
    const curr = snapshot({ cpuTotal: 1200, cpuIdle: 850, netRx: 16_000, netTx: 8_000 });
    const stats = computeStats(prev, curr, 2000);
    expect(stats.cpuPercent).toBe(75);
    expect(stats.rxRate).toBe(3000);
    expect(stats.txRate).toBe(1500);
  });

  it("gives no rates when the counters went backwards or no time passed", () => {
    const prev = snapshot();
    expect(computeStats(prev, snapshot({ netRx: 0, cpuTotal: 900 }), 3000)).toMatchObject({
      cpuPercent: null,
      rxRate: null,
    });
    expect(computeStats(prev, snapshot({ netRx: 20_000 }), 0).rxRate).toBeNull();
  });
});

describe("formatting", () => {
  it("formats byte sizes with binary units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(15.8 * GiB)).toBe("16 GB");
    expect(formatBytes(2.25 * 1024 * GiB)).toBe("2.3 TB");
  });

  it("formats rates and percentages, with a placeholder when unknown", () => {
    expect(formatRate(2048)).toBe("2.0 KB/s");
    expect(formatRate(null)).toBe("…");
    expect(formatPercent(12.34)).toBe("12%");
    expect(formatPercent(null)).toBe("…");
  });
});
