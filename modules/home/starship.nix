{ pkgs, ... }:
let
  promptChar = pkgs.writeShellApplication {
    name = "starship-prompt-char";
    text = ''
      state="''${STARSHIP_NIX_SHELL_TYPE:-}"
      if [ -z "''${state}" ]; then
        state="''${NIX_SHELL_TYPE:-}"
      fi
      if [ -z "''${state}" ]; then
        state="''${IN_NIX_SHELL:-}"
      fi

      name="''${STARSHIP_NIX_SHELL_NAME:-}"
      if [ -z "''${name}" ]; then
        name="''${NIX_SHELL_NAME:-}"
      fi

      reset=$'\033[0m'
      blue=$'\033[38;2;125;207;255m'
      orange=$'\033[38;2;255;158;100m'
      green=$'\033[1;38;2;142;192;124m'
      snowflake='❄'
      arrow='❯'

      if [ -z "''${state}" ] && [ -z "''${name}" ]; then
        printf '%s%s%s' "''${green}" "''${arrow}" "''${reset}"
        exit 0
      fi

      if [ "''${state}" = pure ]; then
        printf '%s%s%s' "''${blue}" "''${snowflake}" "''${reset}"
      else
        printf '%s%s%s' "''${orange}" "''${snowflake}" "''${reset}"
      fi
    '';
  };
  projectSegment = pkgs.writeShellApplication {
    name = "starship-project";
    runtimeInputs = [ pkgs.gnused ];
    text = ''
      set -euo pipefail

      mode="''${1-}"

      searchDir="''${PWD}"
      workonrc=""

      while [ -n "''${searchDir}" ]; do
        candidate="''${searchDir}/.workonrc"
        if [ -f "''${candidate}" ]; then
          workonrc="''${candidate}"
          break
        fi

        if [ "''${searchDir}" = "/" ]; then
          break
        fi

        searchDir="''${searchDir%/*}"
        if [ -z "''${searchDir}" ]; then
          searchDir="/"
        fi
      done

      if [ -z "''${workonrc}" ]; then
        exit 1
      fi

      if [ "''${mode}" = "--detect" ]; then
        exit 0
      fi

      value=""
      while IFS= read -r line; do
        trimmedLine="$(printf '%s' "''${line}" | sed -e 's/^[[:space:]]*//')"

        case "''${trimmedLine}" in
          'STARSHIP_PROJECT_ENV='* | 'export STARSHIP_PROJECT_ENV='*)
            value="''${trimmedLine#*=}"
            break
            ;;
        esac
      done < "''${workonrc}"

      if [ -z "''${value}" ]; then
        exit 1
      fi

      value="$(printf '%s' "''${value}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

      if [ "''${value#\"}" != "''${value}" ] && [ "''${value%\"}" != "''${value}" ]; then
        value="''${value#\"}"
        value="''${value%\"}"
      elif [ "''${value#\'}" != "''${value}" ] && [ "''${value%\'}" != "''${value}" ]; then
        value="''${value#\'}"
        value="''${value%\'}"
      fi

      if [ -z "''${value}" ]; then
        exit 1
      fi

      lookup="''${value}"
      output=""

      if [ -n "''${!lookup-}" ]; then
        output="''${!lookup}"
      else
        while IFS= read -r candidateLine; do
          trimmedLine="$(printf '%s' "''${candidateLine}" | sed -e 's/^[[:space:]]*//')"

          case "''${trimmedLine}" in
            "''${lookup}="* | "export ''${lookup}="*)
              candidate="''${trimmedLine#*=}"
              candidate="$(printf '%s' "''${candidate}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

              if [ "''${candidate#\"}" != "''${candidate}" ] && [ "''${candidate%\"}" != "''${candidate}" ]; then
                candidate="''${candidate#\"}"
                candidate="''${candidate%\"}"
              elif [ "''${candidate#\'}" != "''${candidate}" ] && [ "''${candidate%\'}" != "''${candidate}" ]; then
                candidate="''${candidate#\'}"
                candidate="''${candidate%\'}"
              fi

              if [ -n "''${candidate}" ]; then
                output="''${candidate}"
                break
              fi
              ;;
          esac
        done < "''${workonrc}"
      fi

      if [ -z "''${output}" ]; then
        output="$(
          (
            set +e
            set +u
            set -a
            # shellcheck disable=SC1090
            . "''${workonrc}" >/dev/null 2>&1 || true
            printf '%s' "''${!lookup-}"
          )
        )"
      fi

      output="$(printf '%s' "''${output}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

      if [ -z "''${output}" ]; then
        output="''${lookup}"
      fi

      printf '%s' "''${output}"
    '';
  };
in
{
  programs.starship = {
    enable = true;
    settings = {
      add_newline = false;
      format = ''
        [╭](fg:#7aa2f7) $time $username @ $hostname ''${custom.project}$fill$gcloud$python
        [╰](fg:#7aa2f7) $directory $git_branch $git_status''${custom.prompt_char}
      '';
      right_format = "";

      fill = {
        symbol = " ";
      };

      # Prefer GCP context; hide AWS info to avoid stale region like eu-west-1
      aws = { disabled = true; };
      gcloud = {
        disabled = false;
        symbol = "☁ ";
        # format = " [$symbol$account@$project]($style)";
        format = " [$symbol$project]($style)";
        style = "fg:#7dcfff";
      };
      time = {
        disabled = false;
        format = "[\\[$time\\]]($style)";
        time_format = "%H:%M";
        style = "fg:#7dcfff";
      };
      username = {
        style_user = "fg:#c0caf5 bold";
        style_root = "fg:#f7768e bold";
        format = "[$user]($style)";
        disabled = false;
        show_always = true;
      };
      hostname = {
        ssh_only = false;
        ssh_symbol = "🌐 ";
        format = "[$hostname]($style)";
        trim_at = ".local";
        disabled = false;
        style = "fg:#c0caf5 bold";
      };
      directory = {
        format = "[$path]($style)";
        style = "fg:#89dceb bold";
        truncation_length = 3;
        truncation_symbol = ".../";
      };
      git_branch = {
        format = "[\\[$symbol$branch\\]]($style)";
        style = "fg:#bb9af7";
        symbol = " ";
      };
      git_status = {
        style = "fg:#ff9e64";
      };
      custom = {
        prompt_char = {
          command = "${promptChar}/bin/starship-prompt-char";
          format = "$output  ";
          when = "true";
        };
        project = {
          command = "${projectSegment}/bin/starship-project";
          format = " [:$output:]($style)";
          style = "fg:#f7768e";
          when = "${projectSegment}/bin/starship-project --detect";
        };
      };
      character = {
        disabled = true;
      };
      python = {
        format = " [$virtualenv]($style)";
        style = "fg:#e0af68";
        symbol = "";
        pyenv_version_name = false;
        python_binary = "python";
      };
      nix_shell = {
        disabled = true;
      };
    };
  };
}
