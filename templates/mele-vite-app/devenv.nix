{ pkgs, config, ... }:

{
  mele.app = {
    enable = true;
    name = "example";
  };

  env = {
    APP_DATA_DIR = "./data";
    PORT = "8080";
  };

  packages = [
    pkgs.git
    pkgs.nodejs_22
  ];

  scripts."app:dev".exec = ''
    npm run dev -- "$@"
  '';

  scripts."app:build".exec = ''
    npm run build
  '';

  scripts."app:check".exec = ''
    npm run check
  '';

  scripts."app:serve".exec = ''
    set -euo pipefail
    npm run build
    npm run start
  '';

  scripts."app:doctor".exec = ''
    set -euo pipefail
    echo "🔎 Checking example..."
    npm run check
    nix flake show --extra-experimental-features 'nix-command flakes' --json . >/dev/null
    echo "✅ example is ready to build and deploy"
  '';

  enterShell = ''
    if [ ! -d node_modules ]; then
      echo "📦 Installing npm dependencies..."
      npm ci
    fi

    echo "🚀 example MeLE Vite app"
    echo ""
    echo "🧪 Check:      app:check"
    echo "🏗️  Build:      app:build"
    echo "💻 Dev:        app:dev"
    echo "📦 OCI image:  mele:image"
    echo "🚀 Deploy:     mele:deploy"
    echo "🩺 Live check: mele:health  |  mele:logs"
    echo "📜 Releases:   mele:releases  |  mele:rollback"
    echo "💾 Backups:    mele:backup-status  |  mele:restore"
    echo ""
  '';

  enterTest = ''
    npm run check
  '';
}
