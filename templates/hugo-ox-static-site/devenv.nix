{ pkgs, ... }:

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
      --eval '(progn (find-file "content-org/pages/_index.org") (hb-static-site-export-all))'
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

  scripts."site:deploy:mele".exec = ''
    python3 scripts/site.py deploy-mele "$@"
  '';

  scripts."site:rollback:mele".exec = ''
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
🚀 Deploy to MeLE: site:deploy:mele
↩️  Roll back:      site:rollback:mele --release <id>
🐙 GitHub Pages:  github:setup

Edit hugo.toml for title, baseURL, and [params.mele].
EOF
  '';

  tasks."site:build".exec = "site:build";
  tasks."site:serve".exec = "site:serve";
  tasks."site:export-org".exec = "site:export-org";
  tasks."site:doctor".exec = "site:doctor";
  tasks."site:deploy:mele".exec = "site:deploy:mele";
  tasks."site:rollback:mele".exec = "site:rollback:mele";
  tasks."github:setup".exec = "github:setup";
}
