# Onboarding existing projects to MeLE apps

MeLE app projects import a central devenv module from this repository. They do not copy scripts from `nixos-config`.

Use `mele-app:onboard` from this repository to print the snippets for an existing project:

```sh
devenv -q shell -- mele-app:onboard ~/ws/hedonis --app-name hedonis
```

Add the module import to the project's `devenv.yaml`:

```yaml
inputs:
  nixos-config:
    url: github:behaghel/nixos-config
    flake: false
imports:
  - nixos-config/modules/flake/mele-app
```

Then enable the app in the project's `devenv.nix`:

```nix
{ ... }:
{
  mele.app = {
    enable = true;
    name = "hedonis";
  };
}
```

The project must expose an OCI archive as flake output `.#ociImage`.
The imported module supplies:

- `mele:deploy`
- `mele:image`
- `mele:status`
- `mele:health`
- `mele:logs`

`mele:deploy` builds `.#ociImage` locally, streams it over SSH, and runs `sudo mele-app deploy` on the MeLE host.

The default host is `hub@192.168.1.199`. Override it per command with:

```sh
MELE_HOST=hub@other-host mele:deploy
```

For MeLE, images should target `linux/amd64`. Pure Go apps can use `pkgs.pkgsCross.gnu64`. Node/TypeScript apps should build their production artifact locally and package it with `dockerTools.buildLayeredImage` as an amd64 Linux image.
