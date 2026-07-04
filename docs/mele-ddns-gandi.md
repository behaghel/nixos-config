# MeLE Gandi LiveDNS updater

MeLE keeps the public app hostnames current when the ISP changes the WAN IPv4 address.

Managed records:

- `home.behaghel.org A`
- `*.home.behaghel.org A`

Both are set to TTL `300`.

## Secret setup

Create a Gandi Personal Access Token with LiveDNS/DNS record write permission for `behaghel.org`, then place it on MeLE outside git:

```sh
sudo install -m 0600 -o root -g root /dev/null /etc/gandi-livedns.env
sudoedit /etc/gandi-livedns.env
```

File contents:

```sh
GANDI_LIVEDNS_TOKEN=pat_xxx
```

## Runtime

The updater is managed by:

```sh
systemctl status gandi-livedns-update-home.timer
systemctl status gandi-livedns-update-home.service
journalctl -u gandi-livedns-update-home.service --no-pager -n 80
```

It runs two minutes after boot and then every five minutes. It logs whether records were unchanged or updated.
