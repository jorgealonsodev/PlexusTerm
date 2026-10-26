# PlexusTerm shell integration for zsh: the user's .zprofile (login shells).
__plexus_zdotdir=$ZDOTDIR
ZDOTDIR=$PLEXUS_USER_ZDOTDIR
if [[ -f $ZDOTDIR/.zprofile ]]; then . $ZDOTDIR/.zprofile; fi
PLEXUS_USER_ZDOTDIR=$ZDOTDIR
ZDOTDIR=$__plexus_zdotdir
