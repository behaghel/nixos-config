{ pkgs, lib, inputs, ... }:

{
  packages = with pkgs; [
    dart-sass
    gh
    git
    hugo
    openssh
    python3
    rsync
  ];

  scripts."site:build".exec = ''
    hugo --gc --minify "$@"
  '';

  scripts."site:serve".exec = ''
    set -euo pipefail

    hugo version | grep -q '+extended' || {
      echo "Hugo Extended is required for SCSS processing." >&2
      exit 1
    }
    command -v dart-sass >/dev/null || {
      echo "dart-sass is required for modern Sass @use support." >&2
      echo "Reload direnv or run through: devenv -q shell -- site:serve" >&2
      exit 1
    }

    hugo server --buildDrafts --disableFastRender --navigateToChanged "$@"
  '';

  scripts."site:check-links".exec = ''
    set -euo pipefail

    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    hugo --gc --minify --destination "$tmp"
    python3 scripts/check_internal_links.py "$tmp"
  '';

  scripts."site:export-org".exec = ''
    set -euo pipefail

    command -v emacs >/dev/null || {
      echo "emacs is required for Org export." >&2
      exit 1
    }
    test -d content-org || { echo "missing content-org/" >&2; exit 1; }

    emacs --batch -Q \
      -L "$HOME/.emacs.d/packages/hb-static-site" \
      -L "$HOME/.emacs.d/straight/repos/ox-hugo" \
      -L "$HOME/.emacs.d/straight/repos/tomelr" \
      -L "$HOME/.emacs.d/straight/repos/htmlize" \
      -l hb-static-site \
      --eval '(progn (setq org-hugo-base-dir ".") (find-file "content-org/pages/_index.org") (hb-static-site-export-all))'
  '';

  scripts."site:doctor".exec = ''
    set -euo pipefail

    test -f hugo.toml || { echo "missing hugo.toml" >&2; exit 1; }
    test -d content-org || { echo "missing content-org/" >&2; exit 1; }
    test -d content || { echo "missing content/" >&2; exit 1; }

    mele_host=$(python3 - <<'PY'
import tomllib
with open("hugo.toml", "rb") as handle:
    data = tomllib.load(handle)
print(data.get("params", {}).get("mele", {}).get("host", "hub@mele"))
PY
)

    hugo version | grep -q '+extended' || {
      echo "Hugo Extended is required for SCSS processing." >&2
      exit 1
    }
    command -v dart-sass >/dev/null || {
      echo "dart-sass is required for modern Sass @use support." >&2
      exit 1
    }

    hugo config >/dev/null
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    hugo --gc --minify --destination "$tmp"

    if [ -z "''${MELE_SKIP_SSH_CHECK:-}" ]; then
      ssh -o BatchMode=yes -o ConnectTimeout=5 "$mele_host" true || {
        echo "MeLE SSH check failed for $mele_host" >&2
        echo "Set MELE_SKIP_SSH_CHECK=1 to skip this check." >&2
        exit 1
      }
    else
      echo "Skipping MeLE SSH check because MELE_SKIP_SSH_CHECK is set."
    fi

    if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      dirty=$(git status --short content-org content || true)
      if [ -n "$dirty" ]; then
        echo "Warning: content-org/ or content/ has uncommitted changes:" >&2
        printf '%s\n' "$dirty" >&2
      fi
    fi

    echo "site doctor passed"
  '';

  scripts."mele:deploy".exec = ''
    python3 scripts/site.py deploy-mele "$@"
  '';

  scripts."mele:rollback".exec = ''
    python3 scripts/site.py rollback-mele "$@"
  '';

  scripts."github:setup".exec = ''
    python3 scripts/site.py github-setup "$@"
  '';

  enterShell = ''
    cat <<'EOF'
🌐 Hugo ox-hugo static site

✍️  Write Org in content-org/ (Emacs + hb-static-site-mode)
🧭 Emacs: C-c w s sections, C-c w p bundle pages, C-c w P flat pages, C-c w n posts
📝 Export Org:      site:export-org
📝 Commit generated Markdown in content/
🏗️  Build:          site:build
🔎 Check:          MELE_SKIP_SSH_CHECK=1 site:doctor
🔗 Links:          site:check-links
🚀 Deploy to MeLE: mele:deploy
↩️  Roll back:      mele:rollback --release <id>
🐙 GitHub Pages:  github:setup

Edit hugo.toml for title, baseURL, and [params.mele].
EOF
  '';

  tasks."site:build".exec = "site:build";
  tasks."site:serve".exec = "site:serve";
  tasks."site:check-links".exec = "site:check-links";
  tasks."site:export-org".exec = "site:export-org";
  tasks."site:doctor".exec = "site:doctor";
  tasks."mele:deploy".exec = "mele:deploy";
  tasks."mele:rollback".exec = "mele:rollback";
  tasks."github:setup".exec = "github:setup";

  git-hooks.hooks.site-check-links = {
    enable = true;
    name = "Site internal links";
    entry = "devenv -q shell -- site:check-links";
    language = "system";
    pass_filenames = false;
  };

  # Agent marketplace: explicit plugin opt-in via bundles.
  # See marketplace/README.md for per-plugin and select usage.
  claude.code = let
    mp = import (inputs.agent-marketplace + "/marketplace/lib.nix") { inherit lib; };
    bundle = mp.bundles.total-spec;
  in {
    enable = true;
    commands = bundle.commands;
    hooks = mp.hooks;
    mcpServers.devenv = mp.mcpServers.devenv;
  };

  opencode = let
    mp = import (inputs.agent-marketplace + "/marketplace/lib.nix") { inherit lib; };
    bundle = mp.bundles.total-spec;
  in {
    enable = true;
    skills = mp.skills // bundle.skills;
    commands = bundle.commands;
    agents = bundle.agents;
  };
}
