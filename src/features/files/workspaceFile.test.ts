import { describe, expect, it } from "vitest";
import { parseWorkspaceFile, workspaceFileText } from "./workspaceFile";

describe("workspace files (VS Code's .code-workspace)", () => {
  it("writes the folders as VS Code does, and reads them back", () => {
    const text = workspaceFileText(["/home/me/app", "/home/me/api"]);
    expect(JSON.parse(text)).toEqual({ folders: [{ path: "/home/me/app" }, { path: "/home/me/api" }] });
    expect(text.endsWith("\n")).toBe(true);
    expect(parseWorkspaceFile(text, "/home/me/app.code-workspace")).toEqual(["/home/me/app", "/home/me/api"]);
  });

  it("reads VS Code's files: comments, trailing commas, names and paths relative to the file", () => {
    const text = `{
      // The project and its API.
      "folders": [
        { "path": "." },
        { "name": "Server", "path": "../api" },
        /* elsewhere */ { "path": "/srv/shared", },
      ],
      "settings": { "url": "http://example.com/a//b" },
    }`;
    expect(parseWorkspaceFile(text, "/home/me/proj/app.code-workspace")).toEqual([
      "/home/me/proj",
      "/home/me/api",
      "/srv/shared",
    ]);
  });

  it("resolves Windows paths", () => {
    const text = '{ "folders": [ { "path": "src" }, { "path": "..\\\\lib" }, { "path": "D:\\\\data" } ] }';
    expect(parseWorkspaceFile(text, "C:\\work\\app\\app.code-workspace")).toEqual([
      "C:\\work\\app\\src",
      "C:\\work\\lib",
      "D:\\data",
    ]);
  });

  it("keeps each folder once and leaves out remote folders and broken entries", () => {
    const text = JSON.stringify({
      folders: [{ path: "/a" }, { path: "/a/" }, { uri: "vscode-remote://ssh-remote+box/srv" }, { path: 3 }, "x", { path: "" }],
    });
    expect(parseWorkspaceFile(text, "/w.code-workspace")).toEqual(["/a"]);
  });

  it("finds no folders in a file that is not a workspace", () => {
    expect(parseWorkspaceFile("not json", "/w.code-workspace")).toEqual([]);
    expect(parseWorkspaceFile('{ "settings": {} }', "/w.code-workspace")).toEqual([]);
    expect(parseWorkspaceFile("[1, 2]", "/w.code-workspace")).toEqual([]);
  });
});
