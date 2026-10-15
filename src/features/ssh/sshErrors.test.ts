import { describe, expect, it } from "vitest";
import { describeSshError, toSshError } from "./sshErrors";

describe("toSshError", () => {
  it("passes structured backend errors through", () => {
    const err = { kind: "unknownHost", host: "h", fingerprint: "SHA256:abc", otherKnownKeys: [] };
    expect(toSshError(err)).toEqual(err);
  });

  it("wraps plain strings and unknown values as connection errors", () => {
    expect(toSshError("boom")).toEqual({ kind: "connection", message: "boom" });
    expect(toSshError(42)).toEqual({ kind: "connection", message: "42" });
  });
});

describe("describeSshError", () => {
  it("explains a changed host key without offering to trust it", () => {
    const text = describeSshError({
      kind: "hostKeyChanged",
      host: "[h]:2222",
      fingerprint: "SHA256:new",
      line: 4,
    });
    expect(text).toContain("REMOTE HOST IDENTIFICATION HAS CHANGED");
    expect(text).toContain("SHA256:new");
    expect(text).toContain("line 4");
  });

  it("warns when keys of another type are already known for the host", () => {
    const text = describeSshError({
      kind: "unknownHost",
      host: "h",
      fingerprint: "SHA256:x",
      otherKnownKeys: ["ssh-rsa", "ecdsa-sha2-nistp256"],
    });
    expect(text).toContain("already has ssh-rsa, ecdsa-sha2-nistp256 key(s) recorded");
  });

  it("describes the other kinds", () => {
    expect(describeSshError({ kind: "authFailed" })).toBe("Authentication failed.");
    expect(describeSshError({ kind: "connection", message: "refused" })).toBe("refused");
    expect(describeSshError({ kind: "unknownSession", id: 3 })).toBe("Session 3 is no longer open.");
    expect(describeSshError({ kind: "unknownHost", host: "h", fingerprint: "SHA256:x", otherKnownKeys: [] })).toBe(
      "The authenticity of host h can't be established. Fingerprint: SHA256:x",
    );
  });
});
