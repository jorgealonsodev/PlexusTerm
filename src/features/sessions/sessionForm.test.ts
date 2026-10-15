import { describe, expect, it } from "vitest";
import { formFromSession, parseSessionForm, type SessionForm } from "./sessionForm";

const form = (overrides: Partial<SessionForm> = {}): SessionForm => ({
  name: "Web",
  folder: " Prod / Web ",
  host: "web.example.com",
  port: "",
  username: "deploy",
  method: "password",
  password: "",
  keyPath: "",
  passphrase: "",
  ...overrides,
});

describe("parseSessionForm", () => {
  it("builds a saved session with a normalized folder and no password", () => {
    expect(parseSessionForm(form(), "id-1")).toEqual({
      ok: true,
      session: {
        id: "id-1",
        name: "Web",
        folder: "Prod/Web",
        host: "web.example.com",
        port: 22,
        username: "deploy",
        auth: { method: "password" },
      },
    });
  });

  it("defaults the name to user@host", () => {
    expect(parseSessionForm(form({ name: "  ", host: "h:2200" }), "x")).toMatchObject({
      ok: true,
      session: { name: "deploy@h", port: 2200 },
    });
  });

  it("keeps the key path but not the passphrase", () => {
    const result = parseSessionForm(form({ method: "key", keyPath: "~/.ssh/k", passphrase: "secret" }), "x");
    expect(result).toMatchObject({ ok: true, session: { auth: { method: "key", path: "~/.ssh/k" } } });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("reports validation errors", () => {
    expect(parseSessionForm(form({ host: "" }), "x")).toEqual({ ok: false, error: "Host is required" });
  });
});

describe("formFromSession", () => {
  it("round-trips a saved session", () => {
    const parsed = parseSessionForm(form({ method: "key", keyPath: "/k", port: "2222" }), "id-9");
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parseSessionForm(formFromSession(parsed.session), "id-9")).toEqual(parsed);
  });
});
