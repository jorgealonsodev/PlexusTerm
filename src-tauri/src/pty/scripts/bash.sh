# PlexusTerm shell integration for bash: OSC 133 marks (A prompt, B command line, C command
# runs, D;exit code finished). Started with --rcfile, so it loads the ~/.bashrc bash would have
# loaded; bash reads /etc/bash.bashrc itself where it is built to (Debian, Ubuntu, Arch).
if [ -r ~/.bashrc ]; then . ~/.bashrc; fi

if [[ $- == *i* && -z ${__plexus_integration-} ]]; then
  __plexus_integration=1
  # The folder as OSC 7 reports it (file://host/path), percent-encoded byte by byte.
  __plexus_cwd() {
    local LC_ALL=C path=$PWD out= c i
    if [[ $path == *[!a-zA-Z0-9/._~-]* ]]; then
      for ((i = 0; i < ${#path}; i++)); do
        c=${path:i:1}
        case $c in
          [a-zA-Z0-9/._~-]) out+=$c ;;
          *) printf -v c '%%%02X' "'$c"; out+=$c ;;
        esac
      done
    else
      out=$path
    fi
    printf '\e]7;file://%s%s\a' "${HOSTNAME-}" "$out"
  }
  # First at every prompt, while $? is still the command's: D with its exit code, the folder
  # (OSC 7: the Explorer follows it at once), then A.
  __plexus_precmd() {
    local status=$?
    printf '\e]133;D;%s\a' "$status"
    __plexus_cwd
    printf '\e]133;A\a'
    return "$status"
  }
  # Last at every prompt: B ends the prompt, also one a prompt theme rewrote just before. Only
  # with PS0 (bash 4.4 and later), which gives C: without it the terminal could not tell the
  # command line from the command's output (macOS's /bin/bash is 3.2).
  __plexus_prompt_end() {
    local status=$?
    if ((BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4))); then
      [[ $PS1 == *'133;B'* ]] || PS1="$PS1"'\[\e]133;B\a\]'
    fi
    return "$status"
  }
  if [[ $(declare -p PROMPT_COMMAND 2>/dev/null) == 'declare -a'* ]]; then
    PROMPT_COMMAND=(__plexus_precmd "${PROMPT_COMMAND[@]}" __plexus_prompt_end)
  else
    __plexus_theirs=${PROMPT_COMMAND-}
    # `foo;` followed by `; bar` would be `;;`, which bash refuses.
    while [[ $__plexus_theirs == *[\;[:space:]] ]]; do __plexus_theirs=${__plexus_theirs%?}; done
    PROMPT_COMMAND="__plexus_precmd${__plexus_theirs:+; $__plexus_theirs}; __plexus_prompt_end"
    unset __plexus_theirs
  fi
  # Shown once a command line is read, before it runs (bash 4.4 and later).
  PS0='\e]133;C\a'"${PS0-}"
  # agy 1.4 serves its plan usage only to whoever knows the token on its command line: PlexusTerm
  # gives it one, so the bar under the terminal can show the usage. Only when this agy knows the
  # flag (checked once), and never over an agy alias or function of the user's.
  if [[ -n ${PLEXUS_AGY_CSRF-} ]] && ! alias agy >/dev/null 2>&1 && ! declare -F agy >/dev/null; then
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
