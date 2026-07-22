# Transactional Email

Shared SMTP settings live in `modules/nixos/smtp2go.nix` under:

```nix
hub.transactionalEmail.smtp2go
```

Current provider:

| Attribute | Value |
|---|---|
| `host` | `mail-eu.smtp2go.com` |
| `port` | `2525` |
| `username` | `behaghel.org` |
| `fromAddress` | `notifications@behaghel.org` |
| `passwordStoreKey` | `behaghel.org-sender-user-smtp2go.com` |
| `passwordFile` | `/etc/transactional-email-smtp-pass` |

The password is not committed. Hosts that send transactional email should materialize `passwordFile` from the password-store entry with root-only permissions.

## MeLE setup

Install the SMTP2GO password on MeLE:

```sh
pass show behaghel.org-sender-user-smtp2go.com | ssh hub@mele 'sudo install -m 0600 -o root -g root /dev/stdin /etc/transactional-email-smtp-pass'
```

## Using from NixOS services

For NixOS modules, read the shared config and pass it to the service-specific SMTP settings:

```nix
let
  smtp = config.hub.transactionalEmail.smtp2go;
in
{
  some.service.smtp = {
    host = smtp.host;
    port = smtp.port;
    username = smtp.username;
    passwordFile = smtp.passwordFile;
    from = smtp.fromAddress;
  };
}
```

For Alertmanager, this repository maps the same values to `services.prometheus.alertmanager.configuration.global`.

## Audiobookshelf

Audiobookshelf SMTP settings are configured through its web UI. Use the shared values:

| Audiobookshelf field | Value |
|---|---|
| Host | `mail-eu.smtp2go.com` |
| Port | `2525` |
| Secure | off |
| Username | `behaghel.org` |
| Password | value from `pass show behaghel.org-sender-user-smtp2go.com` |
| From Address | `notifications@behaghel.org` |

Keep `Secure` off for port `2525`; the server uses STARTTLS rather than implicit TLS.

## MeLE apps

For containerized MeLE apps, prefer SecretSpec/env names like:

```text
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASSWORD
SMTP_FROM
```

Use the shared Nix settings for non-secret defaults and store the password in `/etc/mele-apps/<app>.env` or another host-local secret file. Do not bake SMTP passwords into images or committed config.
