//! Makes the Windows shells report their folder with every prompt (OSC 9;9, as ConEmu and
//! Windows Terminal read it), so the Explorer can follow the terminal: Windows gives no way to
//! read another process's folder that works for PowerShell.
//!
//! On Linux and macOS, bash and zsh load scripts that mark the prompt, the command line, the
//! command's run and its exit code (OSC 133), after the user's own startup files.

use std::path::Path;

/// Arguments and environment to add when starting `program`.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Integration {
    /// Replaces the arguments (only given when the user set none).
    pub args: Option<Vec<String>>,
    pub env: Vec<(String, String)>,
}

/// PowerShell: wraps whatever `prompt` the profile left (oh-my-posh, starship...) so it starts
/// with the folder report. That prompt runs first, while `$?` still holds the last command's. No double quotes, so it survives the Windows command line as is.
pub const POWERSHELL_PROMPT: &str = "$global:__plexusPrompt=$function:prompt;\
function global:prompt{$o=& $global:__plexusPrompt;\
$l=$executionContext.SessionState.Path.CurrentLocation;\
if($l.Provider.Name -eq 'FileSystem'){((([char]27),']9;9;',([char]34),$l.ProviderPath,([char]34),([char]27),'\\') -join '')+($o -join '')}else{$o}}";

/// Git Bash: the Windows form of `$PWD` (`/c/Users` is `C:\Users`, without starting a program
/// at every prompt; `cygpath` only outside a drive). bash keeps `$?` for the prompt.
pub const GIT_BASH_REPORT: &str = r#"__plexus_dir=; if [[ $PWD =~ ^/([a-zA-Z])(/.*)?$ ]]; then __plexus_dir="${BASH_REMATCH[1]^^}:${BASH_REMATCH[2]:-/}"; __plexus_dir="${__plexus_dir//\//\\}"; else __plexus_dir="$(cygpath -w "$PWD" 2>/dev/null)"; fi; [ -n "$__plexus_dir" ] && printf '\e]9;9;"%s"\e\\' "$__plexus_dir""#;

/// cmd: the folder report in front of the prompt, `$P$G` (cmd's own) unless one is set.
const CMD_REPORT: &str = "$e]9;9;$P$e\\";

fn shell_name(program: &str) -> String {
    let name = program.rsplit(['\\', '/']).next().unwrap_or(program);
    let name = name.to_ascii_lowercase();
    name.strip_suffix(".exe").unwrap_or(&name).to_string()
}

/// Git for Windows' bash, not the `bash.exe` of System32 (which starts WSL).
fn is_git_bash(program: &str) -> bool {
    let path = program.to_ascii_lowercase().replace('/', "\\");
    shell_name(program) == "bash" && path.contains("\\git\\")
}

/// bash's startup script (`--rcfile`), and zsh's in a folder of their own (`ZDOTDIR`).
pub const BASH_SCRIPT: &str = include_str!("scripts/bash.sh");
pub const ZSH_ENV: &str = include_str!("scripts/zsh/.zshenv");
pub const ZSH_PROFILE: &str = include_str!("scripts/zsh/.zprofile");
pub const ZSH_RC: &str = include_str!("scripts/zsh/.zshrc");
/// fish's, sourced after its config.fish (`--init-command`).
pub const FISH_SCRIPT: &str = include_str!("scripts/fish.fish");

/// The files of [`install_scripts`], relative to its folder.
const SCRIPTS: [(&str, &str); 5] = [
    ("bash.sh", BASH_SCRIPT),
    ("fish.fish", FISH_SCRIPT),
    ("zsh/.zshenv", ZSH_ENV),
    ("zsh/.zprofile", ZSH_PROFILE),
    ("zsh/.zshrc", ZSH_RC),
];

/// Writes the startup scripts to `dir` (in the app's config folder, which only the user can
/// change), replacing any that differ from this version's. Each is written aside and renamed into
/// place, so a shell starting meanwhile never reads half a script.
pub fn install_scripts(dir: &Path) -> std::io::Result<()> {
    use std::io::Write;
    for (name, contents) in SCRIPTS {
        let path = dir.join(name);
        if std::fs::read_to_string(&path).is_ok_and(|current| current == contents) {
            continue;
        }
        let parent = path.parent().unwrap_or(dir);
        std::fs::create_dir_all(parent)?;
        // Readable only by the user (0600 on Unix), like the files of `write_private`.
        let mut file = tempfile::NamedTempFile::new_in(parent)?;
        file.write_all(contents.as_bytes())?;
        file.as_file().sync_all()?;
        file.persist(&path).map_err(|e| e.error)?;
    }
    Ok(())
}

/// The scripts folder for a shell starting now: the files are checked (and written again when
/// something removed or changed them) so bash and zsh never point at missing startup files, which
/// would leave out the user's own. None when they cannot be written: the shell starts plain.
pub fn ready_scripts(dir: Option<&Path>) -> Option<&Path> {
    dir.filter(|dir| install_scripts(dir).is_ok())
}

/// The variables the shell would otherwise get, read when it starts.
#[derive(Default)]
pub struct Inherited<'a> {
    /// cmd's PROMPT.
    pub prompt: Option<&'a str>,
    /// bash's PROMPT_COMMAND.
    pub prompt_command: Option<&'a str>,
    /// zsh's ZDOTDIR.
    pub zdotdir: Option<&'a str>,
    /// Where [`install_scripts`] wrote the scripts; None leaves bash and zsh as they are.
    pub scripts: Option<&'a Path>,
}

/// What to add to start `program` (with the user's `args`) so it reports its folder.
pub fn integration(program: &str, args: &[String], inherited: Inherited) -> Integration {
    if is_git_bash(program) {
        // `foo;` followed by `; report` would be `;;`, which bash refuses.
        let theirs = inherited
            .prompt_command
            .map(|c| c.trim_end().trim_end_matches(';').trim_end());
        let command = match theirs.filter(|c| !c.is_empty()) {
            Some(theirs) => format!("{theirs}; {GIT_BASH_REPORT}"),
            None => GIT_BASH_REPORT.to_string(),
        };
        return Integration {
            args: None,
            env: vec![("PROMPT_COMMAND".into(), command)],
        };
    }
    let prompt = inherited.prompt;
    match shell_name(program).as_str() {
        "bash" if cfg!(unix) && args.is_empty() => match inherited.scripts {
            Some(dir) => Integration {
                args: Some(vec![
                    "--rcfile".into(),
                    dir.join("bash.sh").to_string_lossy().into_owned(),
                ]),
                env: vec![],
            },
            None => Integration::default(),
        },
        // The path goes through a variable: fish never splits it, whatever characters it has.
        "fish" if cfg!(unix) && args.is_empty() => match inherited.scripts {
            Some(dir) => Integration {
                args: Some(vec![
                    "--init-command".into(),
                    "source $PLEXUS_FISH_INIT".into(),
                ]),
                env: vec![(
                    "PLEXUS_FISH_INIT".into(),
                    dir.join("fish.fish").to_string_lossy().into_owned(),
                )],
            },
            None => Integration::default(),
        },
        "zsh" if cfg!(unix) && args.is_empty() => match inherited.scripts {
            Some(dir) => {
                let mut env = vec![(
                    "ZDOTDIR".to_string(),
                    dir.join("zsh").to_string_lossy().into_owned(),
                )];
                if let Some(theirs) = inherited.zdotdir.filter(|d| !d.is_empty()) {
                    env.push(("PLEXUS_USER_ZDOTDIR".into(), theirs.into()));
                    env.push(("PLEXUS_ZDOTDIR_WAS_SET".into(), "1".into()));
                }
                Integration { args: None, env }
            }
            None => Integration::default(),
        },
        "pwsh" | "powershell" if args.is_empty() => Integration {
            args: Some(vec![
                "-NoExit".into(),
                "-Command".into(),
                POWERSHELL_PROMPT.into(),
            ]),
            env: vec![],
        },
        "cmd" => {
            let own = prompt.filter(|p| !p.is_empty()).unwrap_or("$P$G");
            Integration {
                args: None,
                env: vec![("PROMPT".into(), format!("{CMD_REPORT}{own}"))],
            }
        }
        _ => Integration::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn powershell_gets_the_prompt_wrapper_only_without_arguments_of_the_user() {
        for program in [
            "pwsh.exe",
            "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
            "POWERSHELL.EXE",
            "powershell",
        ] {
            let it = integration(program, &[], Inherited::default());
            assert_eq!(
                it.args,
                Some(vec![
                    "-NoExit".to_string(),
                    "-Command".to_string(),
                    POWERSHELL_PROMPT.to_string()
                ]),
                "{program}"
            );
        }
        let theirs = vec!["-NoLogo".to_string()];
        assert_eq!(
            integration("pwsh.exe", &theirs, Inherited::default()),
            Integration::default()
        );
        assert!(!POWERSHELL_PROMPT.contains('"'));
        // The user's prompt runs first, while `$?` still tells how the last command went
        // (Starship and oh-my-posh show it).
        let body = POWERSHELL_PROMPT
            .split("function global:prompt{")
            .nth(1)
            .unwrap();
        assert!(body.starts_with("$o=& $global:__plexusPrompt;"), "{body}");
        assert!(POWERSHELL_PROMPT.contains("]9;9;"));
    }

    #[test]
    fn cmd_reports_its_folder_in_front_of_its_own_prompt() {
        let it = integration("C:\\Windows\\system32\\cmd.exe", &[], Inherited::default());
        assert_eq!(it.args, None);
        assert_eq!(
            it.env,
            vec![("PROMPT".to_string(), "$e]9;9;$P$e\\$P$G".to_string())]
        );
        let custom = integration(
            "cmd.exe",
            &["/k".to_string(), "x.bat".to_string()],
            Inherited {
                prompt: Some("$T$G"),
                ..Default::default()
            },
        );
        assert_eq!(
            custom.env,
            vec![("PROMPT".to_string(), "$e]9;9;$P$e\\$T$G".to_string())]
        );
    }

    #[test]
    fn other_shells_are_left_alone() {
        for program in [
            "bash.exe",
            "C:\\Windows\\System32\\bash.exe",
            "wsl.exe",
            "/bin/zsh",
        ] {
            assert_eq!(
                integration(program, &[], Inherited::default()),
                Integration::default(),
                "{program}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn bash_and_zsh_load_the_marks_from_the_scripts_folder_only_without_arguments_of_the_user() {
        let dir = std::path::Path::new("/home/me/.config/plexusterm/shell-integration");
        let with = |zdotdir| Inherited {
            scripts: Some(dir),
            zdotdir,
            ..Default::default()
        };
        assert_eq!(
            integration("/bin/bash", &[], with(None)),
            Integration {
                args: Some(vec![
                    "--rcfile".to_string(),
                    format!("{}/bash.sh", dir.display())
                ]),
                env: vec![],
            }
        );
        assert_eq!(
            integration("/usr/bin/zsh", &[], with(None)).env,
            vec![("ZDOTDIR".to_string(), format!("{}/zsh", dir.display()))]
        );
        // The user's own ZDOTDIR is where the zsh scripts find the user's files.
        assert_eq!(
            integration("zsh", &[], with(Some("/home/me/.zsh"))).env,
            vec![
                ("ZDOTDIR".to_string(), format!("{}/zsh", dir.display())),
                (
                    "PLEXUS_USER_ZDOTDIR".to_string(),
                    "/home/me/.zsh".to_string()
                ),
                ("PLEXUS_ZDOTDIR_WAS_SET".to_string(), "1".to_string()),
            ]
        );
        assert_eq!(
            integration("/usr/bin/fish", &[], with(None)),
            Integration {
                args: Some(vec![
                    "--init-command".to_string(),
                    "source $PLEXUS_FISH_INIT".to_string()
                ]),
                env: vec![(
                    "PLEXUS_FISH_INIT".to_string(),
                    format!("{}/fish.fish", dir.display())
                )],
            }
        );
        let theirs = vec!["-l".to_string()];
        for program in ["/bin/bash", "/bin/zsh", "/usr/bin/fish"] {
            assert_eq!(
                integration(program, &theirs, with(None)),
                Integration::default(),
                "{program}"
            );
        }
        // Without the scripts written, nothing is added.
        assert_eq!(
            integration("/bin/bash", &[], Inherited::default()),
            Integration::default()
        );
    }

    #[cfg(unix)]
    #[test]
    fn scripts_removed_while_the_app_runs_are_written_again_or_left_out_of_the_shell() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("shell-integration");
        install_scripts(&dir).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(ready_scripts(Some(&dir)), Some(dir.as_path()));
        assert_eq!(
            std::fs::read_to_string(dir.join("zsh/.zshrc")).unwrap(),
            ZSH_RC
        );
        // A file where the folder should be: the shell starts with its own startup files only.
        let blocked = tmp.path().join("blocked");
        std::fs::write(&blocked, "").unwrap();
        assert_eq!(ready_scripts(Some(&blocked)), None);
        assert_eq!(ready_scripts(None), None);
    }

    #[cfg(unix)]
    #[test]
    fn the_scripts_are_written_to_their_folder_and_rewritten_when_they_change() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("shell-integration");
        install_scripts(&dir).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("bash.sh")).unwrap(),
            BASH_SCRIPT
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("zsh/.zshrc")).unwrap(),
            ZSH_RC
        );
        std::fs::write(dir.join("bash.sh"), "tampered").unwrap();
        install_scripts(&dir).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("bash.sh")).unwrap(),
            BASH_SCRIPT
        );
    }

    /// Runs `false` in a real shell started as PlexusTerm starts it, with a home holding only
    /// `rc` as the shell's startup file, and returns what it printed. None when the shell is not
    /// installed.
    #[cfg(unix)]
    fn run_marked(shell: &str, rc: &str) -> Option<String> {
        use portable_pty::{CommandBuilder, PtySize, native_pty_system};
        use std::io::{Read, Write};
        let program = crate::platform::find_program(shell, &std::env::var_os("PATH")?)?;
        let tmp = tempfile::tempdir().unwrap();
        let scripts = tmp.path().join("scripts");
        install_scripts(&scripts).unwrap();
        let home = tmp.path().join("home");
        std::fs::create_dir(&home).unwrap();
        let rc_file = match shell {
            "fish" => home.join(".config/fish/config.fish"),
            _ => home.join(format!(".{shell}rc")),
        };
        std::fs::create_dir_all(rc_file.parent().unwrap()).unwrap();
        std::fs::write(rc_file, rc).unwrap();
        let program = program.to_string_lossy().into_owned();
        let it = integration(
            &program,
            &[],
            Inherited {
                scripts: Some(&scripts),
                ..Default::default()
            },
        );
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut cmd = CommandBuilder::new(&program);
        cmd.args(it.args.unwrap_or_default());
        cmd.env("HOME", &home);
        cmd.env("TERM", "xterm-256color");
        for (name, value) in it.env {
            cmd.env(name, value);
        }
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        writer.write_all(b"false\rexit\r").unwrap();
        // A shell that never exits (a startup file waiting for input) fails the test, never hangs it.
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut out = Vec::new();
            let _ = reader.read_to_end(&mut out);
            let _ = tx.send(out);
        });
        let out = rx.recv_timeout(std::time::Duration::from_secs(20));
        let _ = child.kill();
        let _ = child.wait();
        let out = out.unwrap_or_else(|_| panic!("{shell} did not exit"));
        Some(String::from_utf8_lossy(&out).into_owned())
    }

    #[cfg(unix)]
    #[test]
    fn zsh_without_prompt_percent_keeps_its_prompt_and_still_marks_prompts_and_exit_codes() {
        let Some(out) = run_marked("zsh", "setopt no_prompt_percent\nPS1='> '\n") else {
            eprintln!("zsh is not installed: not checked");
            return;
        };
        assert!(!out.contains("%{"), "{out:?}");
        assert!(!out.contains("\x1b]133;B"), "{out:?}");
        assert!(
            out.contains("\x1b]133;A\x07") && out.contains("\x1b]133;D;1\x07"),
            "{out:?}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_fish_prompt_theme_still_sees_how_the_last_command_ended() {
        let theme = "function fish_prompt; echo -n \"[$status]> \"; end\n";
        let Some(out) = run_marked("fish", theme) else {
            eprintln!("fish is not installed: not checked");
            return;
        };
        assert!(out.contains("[1]> "), "{out:?}");
        assert!(out.contains("\x1b]133;A\x07[1]> \x1b]133;B\x07"), "{out:?}");
    }

    #[cfg(unix)]
    #[test]
    fn bash_zsh_and_fish_mark_the_prompt_the_command_line_and_how_the_command_ended() {
        for shell in ["bash", "zsh", "fish"] {
            let Some(out) = run_marked(shell, "") else {
                eprintln!("{shell} is not installed: not checked");
                continue;
            };
            for mark in [
                "\x1b]133;A\x07",
                "\x1b]133;B\x07",
                "\x1b]133;C\x07",
                "\x1b]133;D;1\x07",
            ] {
                assert!(
                    out.contains(mark),
                    "{shell} did not print {mark:?}: {out:?}"
                );
            }
            // B ends the prompt: what is typed comes after it.
            let b = out.find("\x1b]133;B\x07").unwrap();
            assert!(out[b..].contains("false"), "{shell}: {out:?}");
        }
    }

    #[test]
    fn git_bash_reports_its_folder_after_any_prompt_command_of_its_own() {
        for program in [
            "C:\\Program Files\\Git\\bin\\bash.exe",
            "C:/Program Files/Git/usr/bin/bash.exe",
        ] {
            let it = integration(program, &[], Inherited::default());
            assert_eq!(it.args, None, "{program}");
            assert_eq!(
                it.env,
                vec![("PROMPT_COMMAND".to_string(), GIT_BASH_REPORT.to_string())]
            );
        }
        let theirs = integration(
            "C:\\Program Files\\Git\\bin\\bash.exe",
            &[],
            Inherited {
                prompt_command: Some("history -a"),
                ..Default::default()
            },
        );
        assert_eq!(
            theirs.env,
            vec![(
                "PROMPT_COMMAND".to_string(),
                format!("history -a; {GIT_BASH_REPORT}")
            )]
        );
        // A command already ending in `;` would make `;;`, which bash refuses.
        let ending = integration(
            "C:\\Program Files\\Git\\bin\\bash.exe",
            &[],
            Inherited {
                prompt_command: Some("history -a; "),
                ..Default::default()
            },
        );
        assert_eq!(ending.env, theirs.env);
    }

    /// The command really prints the Windows folder (run with this system's bash).
    #[cfg(unix)]
    #[test]
    fn the_git_bash_report_prints_the_windows_form_of_the_folder() {
        for (pwd, want) in [
            ("/c/Users/me", "\x1b]9;9;\"C:\\Users\\me\"\x1b\\"),
            ("/d", "\x1b]9;9;\"D:\\\"\x1b\\"),
            (
                "/c/Program Files/x",
                "\x1b]9;9;\"C:\\Program Files\\x\"\x1b\\",
            ),
        ] {
            let out = std::process::Command::new("bash")
                .arg("-c")
                .arg(format!("PWD='{pwd}'; {GIT_BASH_REPORT}"))
                .output()
                .unwrap();
            assert_eq!(String::from_utf8_lossy(&out.stdout), want, "{pwd}");
        }
    }
}
