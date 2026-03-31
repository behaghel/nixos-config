{
  pkgs,
  config,
  lib,
  ...
}:
with lib;

{
  programs.zsh = {
    enable = true;
    dotDir = "${config.xdg.configHome}/zsh";
    enableCompletion = true;
    autosuggestion.enable = true;
    syntaxHighlighting.enable = true;
    plugins = [
      # update these in nix-shell -p nix-prefetch-github
      # $ nix-prefetch-github zsh-users zsh-syntax-highlighting
      # {
      #   name = "zsh-syntax-highlighting";
      #   src = pkgs.fetchFromGitHub {
      #     owner = "zsh-users";
      #     repo = "zsh-syntax-highlighting";
      #     "rev" = "0e1bb14452e3fc66dcc81531212e1061e02c1a61";
      #     "sha256" = "13nzmkljmzkjh85phby2d8ni7x0fs0ggnii51vsbngkbqqzxs6zb";
      #     "fetchSubmodules" = true;
      #   };
      # }
    ];

    # stolen: https://github.com/mjlbach/nix-dotfiles/blob/master/home-manager/modules/cli.nix
    initContent = ''
      # Emacs tramp mode compatibility
      [[ $TERM == "tramp" ]] && unsetopt zle && PS1='$ ' && return
      source ~/.aliases
      for i in ~/.config/profile.d/*.profile; do
        source $i
      done
      for i in ~/.config/zsh.d/*.zsh; do
        source $i
      done

      __find_up_file() {
        local search_dir="$PWD"
        local name="$1"

        while true; do
          if [ -e "$search_dir/$name" ]; then
            printf '%s\n' "$search_dir/$name"
            return 0
          fi
          if [ "$search_dir" = "/" ]; then
            return 1
          fi
          search_dir="$(/usr/bin/dirname "$search_dir")"
        done
      }

      __project_context_update() {
        local workonrc key raw resolved marker git_root
        STARSHIP_PROJECT_LABEL=""

        workonrc="$(__find_up_file .workonrc 2>/dev/null || true)"
        if [ -n "''${workonrc}" ]; then
          key="$(
            awk -F= '/^[[:space:]]*(export[[:space:]]+)?STARSHIP_PROJECT_ENV[[:space:]]*=/{
              val=$2
              gsub(/^[ \t"\047]+|[ \t"\047]+$/, "", val)
              print val
              exit
            }' "''${workonrc}"
          )"

          if [ -n "''${key}" ]; then
            raw="''${(P)key-}"
            if [ -n "''${raw}" ]; then
              STARSHIP_PROJECT_LABEL="''${raw}"
            else
              resolved="$(
                awk -F= -v wanted="''${key}" '/^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=/{
                  name=$1
                  gsub(/^[ \t]*export[ \t]+/, "", name)
                  gsub(/[ \t]+$/, "", name)
                  if (name == wanted) {
                    val=$2
                    gsub(/^[ \t"\047]+|[ \t"\047]+$/, "", val)
                    print val
                    exit
                  }
                }' "''${workonrc}"
              )"
              STARSHIP_PROJECT_LABEL="''${resolved:-$key}"
            fi
          fi
        fi

        if [ -z "''${STARSHIP_PROJECT_LABEL}" ]; then
          marker="$(__find_up_file devenv.nix 2>/dev/null || true)"
          if [ -z "''${marker}" ]; then
            marker="$(__find_up_file devenv.yaml 2>/dev/null || true)"
          fi
          if [ -z "''${marker}" ]; then
            marker="$(__find_up_file .devenv.flake.nix 2>/dev/null || true)"
          fi
          if [ -n "''${marker}" ]; then
            STARSHIP_PROJECT_LABEL="dev:$(/usr/bin/basename "$(/usr/bin/dirname "$marker")")"
          fi
        fi

        if [ -z "''${STARSHIP_PROJECT_LABEL}" ]; then
          git_root="$(${pkgs.git}/bin/git rev-parse --show-toplevel 2>/dev/null || true)"
          if [ -n "''${git_root}" ]; then
            STARSHIP_PROJECT_LABEL="$(/usr/bin/basename "$git_root")"
          fi
        fi

        export STARSHIP_PROJECT_LABEL
      }

      chpwd_functions+=(__project_context_update)
      __project_context_update

      # Ensure Ctrl+Space (NUL, ^@) accepts zsh-autosuggestions in common keymaps.
      # Some terminals send NUL for Ctrl+Space; bind that explicitly.
      bindkey -M emacs '^@' autosuggest-accept
      bindkey -M viins '^@' autosuggest-accept
      # Back-compat: also bind caret+space representation if the terminal reports it
      bindkey '^ ' autosuggest-accept
      ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE='fg=23'

      # Lightweight zoxide integration (avoid `zoxide init zsh` at startup).
      __zoxide_add() {
        ${pkgs.zoxide}/bin/zoxide add -- "$PWD" >/dev/null 2>&1 || true
      }

      z() {
        local target
        target="$(${pkgs.zoxide}/bin/zoxide query -- "$@" 2>/dev/null)" || return 1
        [ -n "''${target}" ] && builtin cd -- "''${target}"
      }

      zi() {
        local target
        target="$(${pkgs.zoxide}/bin/zoxide query -i -- "$@" 2>/dev/null)" || return 1
        [ -n "''${target}" ] && builtin cd -- "''${target}"
      }

      chpwd_functions+=(__zoxide_add)
      __zoxide_add

      export -U PATH=~/.nix-profile/bin''${PATH:+:$PATH}
      export -U PATH=/etc/profiles/per-user/$USER/bin''${PATH:+:$PATH}
    '';
    completionInit = ''
      fpath=(${pkgs.pass}/share/zsh/site-functions $fpath)
      autoload -Uz compinit
      compinit -C
    '';
  };
  xdg.configFile."zsh.d/bepo.zsh".source = ./.config/zsh.d/bepo.zsh;
}
