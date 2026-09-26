{ pkgs
, config
, lib
, ...
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
    initContent = mkMerge [
      ''
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
            search_dir="$(${pkgs.coreutils}/bin/dirname "$search_dir")"
          done
        }

        __workonrc_value() {
          local key="$1"
          local file="$2"
          awk -F= -v wanted="$key" '
            /^[[:space:]]*#/ { next }
            /^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=/ {
              name=$1
              gsub(/^[ \t]*export[ \t]+/, "", name)
              gsub(/^[ \t]+|[ \t]+$/, "", name)
              if (name == wanted) {
                val=$0
                sub(/^[^=]*=/, "", val)
                gsub(/^[ \t]+|[ \t]+$/, "", val)
                gsub(/^\047|\047$/, "", val)
                gsub(/^"|"$/, "", val)
                print val
                exit
              }
            }
          ' "$file"
        }

        __workon_sanitize_tag() {
          printf '%s' "$1" \
            | ${pkgs.gnused}/bin/sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/:/-/g'
        }

        __workon_add_tag() {
          local tag
          tag="$(__workon_sanitize_tag "$1")"
          if [ -z "$tag" ]; then
            return 0
          fi
          case ":''${STARSHIP_WORKON_TAGS}:" in
            *":$tag:"*) ;;
            *) STARSHIP_WORKON_TAGS="''${STARSHIP_WORKON_TAGS}''${STARSHIP_WORKON_TAGS:+:}$tag" ;;
          esac
        }

        __workon_gcloud_project() {
          local config_dir active config_file project
          project="''${CLOUDSDK_CORE_PROJECT:-''${GOOGLE_CLOUD_PROJECT:-''${GCLOUD_PROJECT:-}}}"
          if [ -n "$project" ]; then
            printf '%s\n' "$project"
            return 0
          fi

          config_dir="''${CLOUDSDK_CONFIG:-$HOME/.config/gcloud}"
          active="default"
          if [ -r "$config_dir/active_config" ]; then
            active="$(head -n1 "$config_dir/active_config" 2>/dev/null || printf default)"
          fi
          config_file="$config_dir/configurations/config_$active"
          if [ -r "$config_file" ]; then
            project="$(awk -F= '/^[[:space:]]*project[[:space:]]*=/ { val=$2; gsub(/^[ \t]+|[ \t]+$/, "", val); print val; exit }' "$config_file")"
            if [ -n "$project" ]; then
              printf '%s\n' "$project"
            fi
          fi
        }

        __workon_detect_mele() {
          local root="$1"
          if [ "''${__WORKON_MELE_ROOT-}" = "$root" ]; then
            [ "''${__WORKON_MELE_RESULT-}" = "1" ]
            return $?
          fi

          __WORKON_MELE_ROOT="$root"
          if grep -Eqs 'mele[.-]app|mele\.app|mele:deploy' \
            "$root/devenv.nix" \
            "$root/devenv.yaml" \
            "$root/.devenv.flake.nix" \
            "$root/flake.nix" 2>/dev/null; then
            __WORKON_MELE_RESULT="1"
            return 0
          fi

          __WORKON_MELE_RESULT="0"
          return 1
        }

        __workon_active_nix_shell() {
          [ -n "''${IN_NIX_SHELL-}" ] \
            || [ -n "''${DEVENV_ROOT-}" ] \
            || [ -n "''${DEVENV_PROFILE-}" ] \
            || [ -n "''${DEVENV_STATE-}" ]
        }

        __project_context_update() {
          local workonrc root rules rule var value project venv
          STARSHIP_WORKON_TAGS=""
          STARSHIP_NIX_SHELL_ACTIVE=""

          if __workon_active_nix_shell; then
            STARSHIP_NIX_SHELL_ACTIVE="1"
          fi

          workonrc="$(__find_up_file .workonrc 2>/dev/null || true)"
          if [ -z "''${workonrc}" ]; then
            export STARSHIP_WORKON_TAGS STARSHIP_NIX_SHELL_ACTIVE
            return 0
          fi

          root="$(${pkgs.coreutils}/bin/dirname "$workonrc")"
          rules="$(__workonrc_value WORKON_TAG_RULES "$workonrc")"

          for rule in ''${(s: :)rules}; do
            case "$rule" in
              env:*)
                var="''${rule#env:}"
                value="''${(P)var-}"
                __workon_add_tag "$value"
                ;;
              cloud:gcloud)
                project="$(__workon_gcloud_project)"
                if [ -n "$project" ]; then
                  __workon_add_tag "gcp/$project"
                fi
                ;;
              mele)
                if __workon_detect_mele "$root"; then
                  __workon_add_tag "mele"
                fi
                ;;
            esac
          done

          venv=""
          if [ -n "''${VIRTUAL_ENV-}" ]; then
            venv="$(${pkgs.coreutils}/bin/basename "$VIRTUAL_ENV")"
          elif [ -n "''${CONDA_DEFAULT_ENV-}" ]; then
            venv="$CONDA_DEFAULT_ENV"
          fi
          if [ -n "$venv" ]; then
            __workon_add_tag "py/$venv"
          fi

          export STARSHIP_WORKON_TAGS STARSHIP_NIX_SHELL_ACTIVE
        }

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

        export -U PATH=/etc/profiles/per-user/$USER/bin''${PATH:+:$PATH}
        export -U PATH=${config.home.profileDirectory}/bin''${PATH:+:$PATH}
      ''
      (mkOrder 1500 ''
        chpwd_functions+=(__project_context_update)
        precmd_functions+=(__project_context_update)
        __project_context_update

        if [[ $TERM != "dumb" ]]; then
          eval "$(${pkgs.starship}/bin/starship init zsh)"
        fi
      '')
    ];
    completionInit = ''
      fpath=(${pkgs.pass}/share/zsh/site-functions $fpath)
      autoload -Uz compinit
      compinit -C
    '';
  };
  xdg.configFile."zsh.d/bepo.zsh".source = ./.config/zsh.d/bepo.zsh;
}
