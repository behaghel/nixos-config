export EDITOR="emacsclient -t"
if [ "$(uname -s)" = Darwin ]; then
  export VISUAL="emacsclient -r"
  export ALTERNATE_EDITOR=/usr/bin/false
else
  export VISUAL="emacsclient -c -a ''"
  export ALTERNATE_EDITOR=""
fi
export GIT_EDITOR="emacsclient -t"
