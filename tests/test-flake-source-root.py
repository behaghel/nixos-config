"""Check source-root coercion without warming copies or fetching inputs."""

from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class FlakeSourceRootTests(unittest.TestCase):
    def test_actual_entrypoint_supports_cold_source_discovery(self):
        # Import the actual entrypoint, but stub mkFlake to exercise its root
        # argument without fetching the project's full dependency graph.
        fixture = '''{
          outputs = _: (import ./project-flake.nix).outputs {
            nixos-unified.lib.mkFlake = { root, ... }:
              assert builtins.pathExists "${root}/modules/flake/marker.nix";
              {};
            flake-parts.lib.mkFlake = _: module:
              assert builtins.length module.imports > 0;
              assert builtins.all builtins.pathExists module.imports;
              assert builtins.hasAttr "marker.nix" (builtins.readDir
                (module._module.args.root + "/modules/flake"));
              {};
          };
        }'''
        for _ in range(2):
            with tempfile.TemporaryDirectory(prefix="flake-root-") as directory:
                path = Path(directory).resolve()  # /tmp is a symlink on macOS.
                modules = path / "modules/flake"
                modules.mkdir(parents=True)
                # A unique source prevents a previously realised copy masking
                # the bug. No cache deletion or store repair is needed.
                (modules / "marker.nix").write_text(f"# {path}\n{{ }}")
                (path / "project-flake.nix").write_text(
                    (ROOT / "flake.nix").read_text(),
                )
                (path / "flake.nix").write_text(fixture)
                result = subprocess.run(
                    ["nix", "flake", "check", "--no-build",
                     "--no-write-lock-file", f"path:{path}"],
                    capture_output=True, text=True, timeout=60,
                )
                self.assertEqual(
                    result.returncode, 0, result.stdout + result.stderr,
                )


if __name__ == "__main__":
    unittest.main()
