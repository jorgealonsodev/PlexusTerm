//! Makes the Windows shells report their folder with every prompt (OSC 9;9, as ConEmu and
//! Windows Terminal read it), so the Explorer can follow the terminal: Windows gives no way to
//! read another process's folder that works for PowerShell.

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

/// The variables the shell would otherwise get, read when it starts.
#[derive(Default)]
pub struct Inherited<'a> {
    /// cmd's PROMPT.
    pub prompt: Option<&'a str>,
    /// bash's PROMPT_COMMAND.
    pub prompt_command: Option<&'a str>,
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
