export GPG_TTY=$(tty)
export SSH_AUTH_SOCK=$(${HOME}/.nix-profile/bin/gpgconf --list-dirs agent-ssh-socket 2>/dev/null || gpgconf --list-dirs agent-ssh-socket)
