{ lib, config, pkgs, ... }:
let
  cfg = config.hub.darwin.utmBuilder;

  builderSpec =
    "ssh-ng://root@${cfg.hostName} x86_64-linux ${cfg.keyFile} ${toString cfg.cpus} 1 benchmark,big-parallel";
  buildersString = lib.concatStringsSep ";" ([ builderSpec ] ++ cfg.additionalBuilders);

  sshHostConfig = ''
Host ${cfg.hostName}
  Hostname 127.0.0.1
  Port ${toString cfg.port}
  IdentityFile ${cfg.keyFile}
  IdentitiesOnly yes
${cfg.sshConfigExtra}
'';
in
{
  options.hub.darwin.utmBuilder = {
    enable = lib.mkEnableOption "UTM/QEMU-based local x86_64 builder";

    label = lib.mkOption {
      type = lib.types.str;
      default = "org.nixos.utm-builder";
      description = "Launchd label for the builder VM service.";
    };

    hostName = lib.mkOption {
      type = lib.types.str;
      default = "builder-x86";
      description = "SSH hostname used in builders strings and ssh_config.";
    };

    port = lib.mkOption {
      type = lib.types.int;
      default = 2223;
      description = "Local TCP port forwarded to the builder's SSH port.";
    };

    stateDir = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/utm-builder";
      description = "Directory holding the qcow2 image and OVMF vars.";
    };

    imagePath = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/utm-builder/builder.qcow2";
      description = "Path to the qcow2 image to boot.";
    };

    keyFile = lib.mkOption {
      type = lib.types.str;
      default = "/etc/nix/utm-builder_ed25519";
      description = "Private key used to reach the builder VM.";
    };

    privateKeySource = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = "If set, install this private key at keyFile instead of generating a new one.";
    };

    ovmfCode = lib.mkOption {
      type = lib.types.str;
      default = "${pkgs.qemu}/share/qemu/edk2-x86_64-code.fd";
      description = "Read-only OVMF firmware blob.";
    };

    ovmfVars = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/utm-builder/ovmf-vars.fd";
      description = "Writable OVMF vars file cloned on activation if missing.";
    };

    cpus = lib.mkOption {
      type = lib.types.int;
      default = 4;
      description = "vCPUs allocated to the builder VM.";
    };

    memoryMB = lib.mkOption {
      type = lib.types.int;
      default = 4096;
      description = "Memory allocated to the builder VM in MiB.";
    };

    extraQemuArgs = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      description = "Extra arguments appended to qemu-system-x86_64 invocation.";
    };

    additionalBuilders = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      description = "Additional builders (semicolon-separated) appended to nix.settings.builders.";
    };

    sshConfigExtra = lib.mkOption {
      type = lib.types.lines;
      default = "";
      description = "Extra ssh_config stanzas to append to the builder ssh config fragment.";
    };
  };

  config = lib.mkIf cfg.enable {
    system.activationScripts.utmBuilder = ''
      mkdir -p /etc/nix ${cfg.stateDir}
      umask 077
      ${lib.optionalString (cfg.privateKeySource != null) ''
        install -m 600 ${cfg.privateKeySource} ${cfg.keyFile}
        if [ -f ${cfg.privateKeySource}.pub ]; then
          install -m 644 ${cfg.privateKeySource}.pub ${cfg.keyFile}.pub
        else
          ${pkgs.openssh}/bin/ssh-keygen -y -f ${cfg.keyFile} > ${cfg.keyFile}.pub
        fi
      ''}
      ${lib.optionalString (cfg.privateKeySource == null) ''
        if [ ! -f ${cfg.keyFile} ]; then
          ${pkgs.openssh}/bin/ssh-keygen -t ed25519 -N "" -f ${cfg.keyFile}
        fi
      ''}
      if [ ! -f ${cfg.ovmfVars} ]; then
        cp ${pkgs.qemu}/share/qemu/edk2-i386-vars.fd ${cfg.ovmfVars}
      fi
    '';

    environment.etc."ssh/ssh_config.d/110-utm-builder.conf".text = sshHostConfig;

    launchd.daemons.${cfg.label} = {
      serviceConfig = {
        Label = cfg.label;
        ProgramArguments =
          [
            "${pkgs.qemu}/bin/qemu-system-x86_64"
            "-machine" "q35"
            "-cpu" "qemu64"
            "-smp" (toString cfg.cpus)
            "-m" (toString cfg.memoryMB)
            "-accel" "tcg"
            "-nographic"
            "-drive" "if=pflash,format=raw,readonly=on,unit=0,file=${cfg.ovmfCode}"
            "-drive" "if=pflash,format=raw,unit=1,file=${cfg.ovmfVars}"
            "-drive" "file=${cfg.imagePath},if=virtio,format=qcow2"
            "-netdev" "user,id=net0,hostfwd=tcp::${toString cfg.port}-:22"
            "-device" "virtio-net-pci,netdev=net0"
          ]
          ++ cfg.extraQemuArgs;
        RunAtLoad = true;
        KeepAlive = true;
        StandardOutPath = "/var/log/utm-builder.log";
        StandardErrorPath = "/var/log/utm-builder.err.log";
        WorkingDirectory = cfg.stateDir;
        EnvironmentVariables = { PATH = "/usr/bin:/bin:/usr/sbin:/sbin"; };
      };
    };

    nix.settings.builders = buildersString;
  };
}
