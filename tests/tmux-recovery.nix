{ pkgs, lib, inputs }:

let
  cfg = (inputs.home-manager.lib.homeManagerConfiguration {
    inherit pkgs;
    modules = [
      ../modules/home/tmux/default.nix
      {
        home.username = "tester";
        home.homeDirectory = "/tmp/tester";
        home.stateVersion = "24.11";
      }
    ];
  }).config;
  snapshot = lib.findFirst (p: lib.getName p == "tmux-snapshot")
    (throw "FAIL: independent tmux-snapshot command is missing")
    cfg.home.packages;
  scheduler =
    if pkgs.stdenv.isDarwin then
      cfg.launchd.agents.tmux-snapshot.config.StartInterval == 300
      && cfg.launchd.agents.tmux-snapshot.config.ProgramArguments == [ "${snapshot}/bin/tmux-snapshot" ]
    else
      cfg.systemd.user.timers.tmux-snapshot.Timer.OnUnitActiveSec == "5m"
      && cfg.systemd.user.services.tmux-snapshot.Service.ExecStart == [ "${snapshot}/bin/tmux-snapshot" ];
in
assert lib.assertMsg scheduler "snapshot scheduler must run independently every five minutes";
assert lib.assertMsg
  (lib.any (p: lib.hasInfix "@continuum-save-interval '0'" (p.extraConfig or "")) cfg.programs.tmux.plugins)
  "Continuum must not also schedule saves";
pkgs.runCommand "tmux-recovery-tests"
{
  nativeBuildInputs = [ pkgs.bash pkgs.tmux pkgs.coreutils pkgs.diffutils pkgs.gnugrep pkgs.hostname ];
  SNAPSHOT = "${snapshot}/bin/tmux-snapshot";
  RESURRECT = "${pkgs.tmuxPlugins.resurrect}/share/tmux-plugins/resurrect";
} ''
  bash ${./tmux-recovery.sh}
  touch $out
''
