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
        printf '\e]133;A\a'
        __plexus_status $last
        __plexus_prompt
        printf '\e]133;B\a'
    end
end
