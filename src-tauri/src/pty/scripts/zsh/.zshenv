# PlexusTerm shell integration for zsh: ZDOTDIR points here so these files can add the OSC 133
# marks; each loads the user's own file, from the user's ZDOTDIR (or home).
__plexus_zdotdir=$ZDOTDIR
ZDOTDIR=${PLEXUS_USER_ZDOTDIR:-$HOME}
if [[ -f $ZDOTDIR/.zshenv ]]; then . $ZDOTDIR/.zshenv; fi
# The user's .zshenv may move ZDOTDIR: the next files are read from there.
PLEXUS_USER_ZDOTDIR=$ZDOTDIR
ZDOTDIR=$__plexus_zdotdir
