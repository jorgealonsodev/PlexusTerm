# PlexusTerm shell integration for fish: OSC 133 marks (A prompt, B command line, C command runs,
# D;exit code finished). Sourced with --init-command, after the user's config.fish.
set -e PLEXUS_FISH_INIT
if status is-interactive; and not set -q __plexus_integration
    set -g __plexus_integration 1
    function __plexus_preexec --on-event fish_preexec
        printf '\e]133;C\a'
    end
    function __plexus_postexec --on-event fish_postexec
        printf '\e]133;D;%s\a' $status
    end
    # Gives the user's prompt the last command's status, which printing the A mark replaced.
    function __plexus_status
        return $argv[1]
    end
    # The user's prompt (a theme's included) between A and B.
    functions -c fish_prompt __plexus_prompt
    function fish_prompt
        set -l last $status
        # The folder (OSC 7: the Explorer follows it at once), percent-encoded.
        printf '\e]7;file://%s%s\a' (prompt_hostname) (string escape --style=url -- $PWD)
        printf '\e]133;A\a'
        __plexus_status $last
        __plexus_prompt
        printf '\e]133;B\a'
    end
    # agy 1.4 serves its plan usage only to whoever knows the token on its command line: PlexusTerm
    # gives it one, so the bar under the terminal can show the usage. Only when this agy knows the
    # flag (checked once), and never over an agy function or abbreviation of the user's.
    if set -q PLEXUS_AGY_CSRF; and not functions -q agy; and not abbr -q agy
        function agy
            if not set -q __plexus_agy_flag
                if command agy --csrf_token=check help >/dev/null 2>&1
                    set -g __plexus_agy_flag 1
                else
                    set -g __plexus_agy_flag 0
                end
            end
            if test $__plexus_agy_flag = 1
                command agy --csrf_token=$PLEXUS_AGY_CSRF $argv
            else
                command agy $argv
            end
        end
    end
end
