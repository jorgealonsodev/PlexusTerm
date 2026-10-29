# PlexusTerm shell integration for zsh: the user's .zshrc, then the OSC 133 marks (A prompt,
# B command line, C command runs, D;exit code finished). ZDOTDIR goes back to the user's, so
# .zlogin and any zsh started from this one read the user's files.
ZDOTDIR=$PLEXUS_USER_ZDOTDIR
if [[ -f $ZDOTDIR/.zshrc ]]; then . $ZDOTDIR/.zshrc; fi
if [[ $ZDOTDIR == "$HOME" && -z ${PLEXUS_ZDOTDIR_WAS_SET-} ]]; then unset ZDOTDIR; fi
unset PLEXUS_USER_ZDOTDIR PLEXUS_ZDOTDIR_WAS_SET __plexus_zdotdir

if [[ -o interactive && -z ${__plexus_integration-} ]]; then
  __plexus_integration=1
  # The folder as OSC 7 reports it (file://host/path), percent-encoded byte by byte.
  __plexus_cwd() {
    emulate -L zsh
    setopt extended_glob
    local LC_ALL=C
    print -n "\e]7;file://${HOST}${PWD//(#m)[^a-zA-Z0-9\/._~-]/%${(l:2::0:)$(( [##16] #MATCH ))}}\a"
  }
  # First at every prompt, while $? is still the command's: D with its exit code, the folder
  # (OSC 7: the Explorer follows it at once), then A.
  __plexus_precmd() {
    local exit_status=$?
    print -n "\e]133;D;${exit_status}\a"
    __plexus_cwd
    print -n "\e]133;A\a"
    return $exit_status
  }
  # Last at every prompt: B ends the prompt, also one a prompt theme rewrote just before. %{ %}
  # (zero width) only work with PROMPT_PERCENT, on unless the user turned it off.
  __plexus_prompt_end() {
    [[ -o promptpercent ]] || return 0
    [[ $PS1 == *'133;B'* ]] || PS1="$PS1%{"$'\e]133;B\a'"%}"
  }
  __plexus_preexec() { print -n "\e]133;C\a"; }
  precmd_functions=(__plexus_precmd $precmd_functions __plexus_prompt_end)
  preexec_functions+=(__plexus_preexec)
  # agy 1.4 serves its plan usage only to whoever knows the token on its command line: PlexusTerm
  # gives it one, so the bar under the terminal can show the usage. Only when this agy knows the
  # flag (checked once), and never over an agy alias or function of the user's.
  if [[ -n ${PLEXUS_AGY_CSRF-} ]] && (( ! $+aliases[agy] && ! $+functions[agy] )); then
    agy() {
      if [[ -z ${__plexus_agy_flag-} ]]; then
        if command agy --csrf_token=check help >/dev/null 2>&1; then __plexus_agy_flag=1; else __plexus_agy_flag=0; fi
      fi
      if [[ $__plexus_agy_flag == 1 ]]; then
        command agy --csrf_token="$PLEXUS_AGY_CSRF" "$@"
      else
        command agy "$@"
      fi
    }
  fi
fi
