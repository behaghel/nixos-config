{ pkgs }:
pkgs.runCommand "hammerspoon-tests"
{
  nativeBuildInputs = [ pkgs.lua5_4 ];
  src = pkgs.lib.fileset.toSource {
    root = ../.;
    fileset = pkgs.lib.fileset.unions [
      ../modules/home/hammerspoon
      ./test-hammerspoon-fellow.lua
      ./test-hammerspoon-vpn.lua
    ];
  };
}
''
  cd "$src"
  for file in modules/home/hammerspoon/*.lua; do luac -p "$file"; done
  lua tests/test-hammerspoon-fellow.lua
  lua tests/test-hammerspoon-vpn.lua
  touch "$out"
''
