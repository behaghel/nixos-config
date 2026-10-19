{ pkgs }:
let
  shell = import ../modules/home/shell {
    inherit pkgs;
    lib = pkgs.lib;
    config.home.profileDirectory = "/fixture/profile";
  };
in
assert pkgs.lib.hasInfix "/fixture/profile/bin" shell.programs.bash.profileExtra;
assert pkgs.lib.hasInfix "export PATH" shell.programs.bash.profileExtra;
assert pkgs.lib.hasInfix "shell-integration.sh" shell.programs.bash.initExtra;
# The management shell uses Nix; system activation uses Lix. Both must parse
# shared Home Manager modules, including their nested attribute definitions.
pkgs.runCommand "shell-module-parser-tests"
{
  nativeBuildInputs = [ pkgs.lix ];
} ''
  nix-instantiate --parse ${../modules/home/shell/default.nix} > /dev/null
  touch $out
''
