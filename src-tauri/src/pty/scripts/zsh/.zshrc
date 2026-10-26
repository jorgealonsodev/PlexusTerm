# PlexusTerm shell integration for zsh: the user's .zshrc, then the OSC 133 marks (A prompt,
# B command line, C command runs, D;exit code finished). ZDOTDIR goes back to the user's, so
# .zlogin and any zsh started from this one read the user's files.
ZDOTDIR=$PLEXUS_USER_ZDOTDIR
if [[ -f $ZDOTDIR/.zshrc ]]; then . $ZDOTDIR/.zshrc; fi
if [[ $ZDOTDIR == "$HOME" && -z ${PLEXUS_ZDOTDIR_WAS_SET-} ]]; then unset ZDOTDIR; fi
unset PLEXUS_USER_ZDOTDIR PLEXUS_ZDOTDIR_WAS_SET __plexus_zdotdir

if [[ -o interactive && -z ${__plexus_integration-} ]]; then
  __plexus_integration=1
  # First at every prompt, while $? is still the command's: D with its exit code, then A.
  __plexus_precmd() {
    local exit_status=$?
    print -n "\e]133;D;${exit_status}\a\e]133;A\a"
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
fi
