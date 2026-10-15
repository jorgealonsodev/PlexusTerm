import { describe, expect, it } from "vitest";
import { EMPTY_LINE, feedExternal, feedInput, isSecretPrompt, promptBefore, type LineState } from "./lineTracker";

const feed = (...chunks: string[]) => {
  let state: LineState = EMPTY_LINE;
  const commits: string[] = [];
  for (const chunk of chunks) {
    const result = feedInput(state, chunk);
    state = result.state;
    commits.push(...result.commits);
  }
  return { state, commits };
};

describe("feedInput", () => {
  it("appends printable characters, one key or a whole chunk at a time", () => {
    expect(feed("g", "i", "t", " st").state).toEqual({ text: "git st", uncertain: false });
  });

  it("removes the last character on Backspace (DEL or ^H)", () => {
    expect(feed("lss", "\x7f").state.text).toBe("ls");
    expect(feed("lss", "\b").state.text).toBe("ls");
    expect(feed("\x7f").state.text).toBe("");
  });

  it("clears the line on Ctrl+U and Ctrl+C", () => {
    expect(feed("rm -rf", "\x15").state).toEqual(EMPTY_LINE);
    expect(feed("rm -rf", "\x03", "ls").state).toEqual({ text: "ls", uncertain: false });
  });

  it("deletes the previous word on Ctrl+W", () => {
    expect(feed("git commit  ", "\x17").state.text).toBe("git ");
    expect(feed("ls", "\x17").state.text).toBe("");
  });

  it("commits the line on Enter and starts a new one", () => {
    expect(feed("ls -la", "\r", "pw")).toEqual({ state: { text: "pw", uncertain: false }, commits: ["ls -la"] });
    expect(feed("a\rb\r").commits).toEqual(["a", "b"]);
  });

  it("becomes uncertain on arrows, Ctrl+R, Tab, Alt keys and other control keys, until Enter", () => {
    for (const key of ["\x1b[A", "\x1b[D", "\x1bOA", "\x12", "\t", "\x1bb", "\x01"]) {
      const { state, commits } = feed("git", key, "x", "\r");
      expect(commits, JSON.stringify(key)).toEqual([]);
      expect(state, JSON.stringify(key)).toEqual(EMPTY_LINE);
      expect(feed("git", key).state.uncertain, JSON.stringify(key)).toBe(true);
    }
  });

  it("treats a bracketed paste like typing", () => {
    expect(feed("echo ", "\x1b[200~hello\x1b[201~").state).toEqual({ text: "echo hello", uncertain: false });
    // Its newlines are inserted into the line, not run.
    expect(feed("\x1b[200~a\nb\x1b[201~", "\r").commits).toEqual([]);
  });
});

describe("feedExternal", () => {
  it("makes the line uncertain, and starts fresh after an Enter in the data", () => {
    expect(feedExternal({ text: "ls", uncertain: false }, "x")).toEqual({ text: "ls", uncertain: true });
    expect(feedExternal({ text: "ls", uncertain: false }, "uptime\r")).toEqual(EMPTY_LINE);
    expect(feedExternal(EMPTY_LINE, "uptime\rdf")).toEqual({ text: "", uncertain: true });
  });
});

describe("password prompts", () => {
  it("finds the prompt before the echoed text", () => {
    expect(promptBefore("$ git st", "git st")).toBe("$ ");
    // Nothing echoed (a password): the whole line is the prompt.
    expect(promptBefore("Password: ", "hunter2")).toBe("Password: ");
  });

  it("recognises password, passphrase and PIN prompts but not ordinary shell prompts", () => {
    for (const prompt of ["Password: ", "[sudo] password for jorge: ", "Enter passphrase for key '/home/u/.ssh/id': ", "PIN:"]) {
      expect(isSecretPrompt(prompt), prompt).toBe(true);
    }
    for (const prompt of ["user@passwords:~$ ", "$ ", "mysql> "]) expect(isSecretPrompt(prompt), prompt).toBe(false);
  });
});

describe("isSecretPrompt (one-time codes and tokens)", () => {
  it("also recognises verification codes, OTPs and tokens", () => {
    for (const prompt of ["Verification code: ", "Enter token: ", "OTP: ", "2FA code: ", "Authenticator code:", "Enter the security key PIN: "]) {
      expect(isSecretPrompt(prompt), prompt).toBe(true);
    }
    expect(isSecretPrompt("user@host:~$ ")).toBe(false);
  });
});


describe("isSecretPrompt (other languages)", () => {
  it("recognises sudo, ssh and PIN prompts in the interface languages, with ASCII or full-width colons", () => {
    const prompts = [
      "[sudo] contraseña para jorge: ",
      "Contraseña: ",
      "Introduzca la frase de contraseña para la clave '/home/u/.ssh/id': ",
      "Código de verificación: ",
      "[sudo] Passwort für jorge: ",
      "Kennwort: ",
      "[sudo] Mot de passe de jorge : ",
      "[sudo] senha para jorge: ",
      "[sudo] jorge のパスワード: ",
      "[sudo] jorge 的密码：",
      "请输入口令：",
      "[sudo] jorge의 암호: ",
      "비밀번호: ",
      "[sudo] كلمة السر لـ jorge: ",
      "كلمة المرور: ",
      "[sudo] jorge के लिए पासवर्ड: ",
      "[sudo] пароль для jorge: ",
      "Escriba nueva frase de paso: ",
      "Frase de paso:",
      "Entrez la phrase secrète : ",
      "パスフレーズを入力してください: ",
      "密碼：",
      "Código de verificação: ",
      "Bestätigungscode: ",
      "Code de vérification : ",
    ];
    for (const prompt of prompts) expect(isSecretPrompt(prompt), prompt).toBe(true);
  });

  it("still leaves ordinary prompts and output alone", () => {
    for (const prompt of ["jorge@contraseñas:~$ ", "~/senha $ ", "PS C:\\Users\\jorge> ", "mot de passe oublié", "密码学 $ "]) {
      expect(isSecretPrompt(prompt), prompt).toBe(false);
    }
  });
});
