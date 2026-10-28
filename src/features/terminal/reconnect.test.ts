import { describe, expect, it } from "vitest";
import { attemptAfterDrop, MAX_RECONNECT_ATTEMPTS, reconnectDelay, retriesAfter } from "./reconnect";

describe("reconnectDelay", () => {
  it("backs off 1, 2, 5, 10 and 30 s, then waits 30 s, for at most 10 attempts", () => {
    const delays = Array.from({ length: MAX_RECONNECT_ATTEMPTS }, (_, i) => reconnectDelay(i + 1));
    expect(delays).toEqual([1, 2, 5, 10, 30, 30, 30, 30, 30, 30]);
    expect(reconnectDelay(MAX_RECONNECT_ATTEMPTS + 1)).toBeNull();
  });
});

describe("retriesAfter", () => {
  it("retries when the network fails again, on the host or on a jump host", () => {
    expect(retriesAfter({ kind: "connection", message: "refused" })).toBe(true);
    expect(retriesAfter({ kind: "hop", hop: 1, name: "bastion", error: { kind: "connection", message: "timeout" } })).toBe(
      true,
    );
  });

  it("stops on anything the user has to answer or fix: a rejected login, a missing password, a host key", () => {
    expect(retriesAfter({ kind: "authFailed" })).toBe(false);
    expect(retriesAfter({ kind: "secretMissing" })).toBe(false);
    expect(retriesAfter({ kind: "unknownHost", host: "h", fingerprint: "f", otherKnownKeys: [] })).toBe(false);
    expect(retriesAfter({ kind: "hostKeyChanged", host: "h", fingerprint: "f", line: 3 })).toBe(false);
    expect(retriesAfter({ kind: "hop", hop: 1, name: "bastion", error: { kind: "authFailed" } })).toBe(false);
  });
});

describe("attemptAfterDrop", () => {
  it("starts over after a connection that stayed up 30 s, else keeps counting", () => {
    expect(attemptAfterDrop(0, 0)).toBe(1);
    expect(attemptAfterDrop(3, 29_999)).toBe(4);
    expect(attemptAfterDrop(3, 30_000)).toBe(1);
    expect(attemptAfterDrop(MAX_RECONNECT_ATTEMPTS, 1_000)).toBe(MAX_RECONNECT_ATTEMPTS + 1);
  });
});
