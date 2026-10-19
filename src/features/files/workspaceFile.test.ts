import { parse } from "jsonc-parser";
import { describe, expect, it } from "vitest";
import { parseWorkspaceFile, workspaceFileText } from "./workspaceFile";

describe("workspace files (VS Code's .code-workspace)", () => {
  it("writes a new file as VS Code does: paths relative to the file, empty settings, tabs", () => {
    const file = "/home/me/app/app.code-workspace";
    const text = workspaceFileText(["/home/me/app", "/home/me/api", "/srv/shared/x"], file);
    expect(text).toBe(
      '{\n\t"folders": [\n\t\t{\n\t\t\t"path": "."\n\t\t},\n\t\t{\n\t\t\t"path": "../api"\n\t\t},\n' +
        '\t\t{\n\t\t\t"path": "../../../srv/shared/x"\n\t\t}\n\t],\n\t"settings": {}\n}',
    );
    expect(parseWorkspaceFile(text, file)).toEqual(["/home/me/app", "/home/me/api", "/srv/shared/x"]);
  });

  it("writes Windows paths with backslashes, absolute on another drive", () => {
    const file = "C:\\work\\app\\app.code-workspace";
    const text = workspaceFileText(["C:\\work\\app", "C:\\work\\lib", "D:\\data"], file);
    expect(JSON.parse(text).folders).toEqual([{ path: "." }, { path: "..\\lib" }, { path: "D:\\data" }]);
    expect(parseWorkspaceFile(text, file)).toEqual(["C:\\work\\app", "C:\\work\\lib", "D:\\data"]);
  });

  it("rewrites only the folders of an existing file, keeping its comments, settings, names and remote folders", () => {
    const file = "/home/me/proj/app.code-workspace";
    const existing = `{
	// The project and its API.
	"folders": [
		{ "path": "." },
		{ "name": "Server", "path": "../api" },
		{ "uri": "vscode-remote://ssh-remote+box/srv" },
		{ "path": "/old" },
	],
	"settings": { "editor.tabSize": 2 }, // indent
	"extensions": { "recommendations": ["x.y"] },
}`;
    const text = workspaceFileText(["/home/me/proj", "/home/me/api", "/home/me/web"], file, existing);
    expect(text).toContain("// The project and its API.");
    expect(text).toContain('"settings": { "editor.tabSize": 2 }, // indent');
    expect(text).toContain('"extensions": { "recommendations": ["x.y"] }');
    const folders = (parse(text, [], { allowTrailingComma: true }) as { folders: unknown[] }).folders;
    expect(folders).toEqual([
      { path: "." },
      { name: "Server", path: "../api" },
      { path: "../web" },
      { uri: "vscode-remote://ssh-remote+box/srv" },
    ]);
  });

  it("writes a new file over one that is not a workspace", () => {
    const text = workspaceFileText(["/a"], "/a/w.code-workspace", "not json");
    expect(JSON.parse(text)).toEqual({ folders: [{ path: "." }], settings: {} });
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
