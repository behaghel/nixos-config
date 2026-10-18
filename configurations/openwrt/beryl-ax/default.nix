{
  networking.hostName = "beryl-ax";
  services.exitTunnel = {
    enable = true;
    exitNode = {
      address = "100.115.20.65";
      id = "nJDM8knVvy11CNTRL";
    };
    dnsAddress = "9.9.9.9";
    tailnetSuffix = "tail21d416.ts.net";
  };
  # Obtained via the existing authenticated LAN session; private key stays put.
  ssh.hostKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBYctq6oBLSoD7cWdIgX8M0ex9oGh/3Dzopu2WiBCBNw";
}
