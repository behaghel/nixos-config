# Hugo ox-hugo Static Site

Personal-first static site template for Hugo sites authored in Org with ox-hugo.

## Quick start

1. Edit `hugo.toml`.
2. Edit Org sources under `content-org/` from Emacs.
3. Commit generated Markdown under `content/`.
4. Build locally with `site:build`.

## Emacs workflow

This template expects your personal Emacs config to provide `hb-static-site-mode`.
The project still opens safely without that module because `.dir-locals.el` guards
its activation.

- Stable pages live under `content-org/pages/`.
- Denote-created posts live under `content-org/posts/`.
- Generated Hugo Markdown lives under `content/` and is committed.
- `public/` is build output and is ignored.

Normal builds and CI use the committed Markdown and do not require Emacs.

## Local commands

```bash
site:build
MELE_SKIP_SSH_CHECK=1 site:doctor
site:serve
```

## GitHub Pages backup

Authenticate once with `gh auth login`, then create/push the repository and wait
for the GitHub Pages workflow:

```bash
github:setup
```

Useful options:

```bash
github:setup --owner <owner-or-org> --repo <repo-name>
github:setup --private   # Pages for private repos may require a paid GitHub plan
github:setup --no-wait --no-open
```

The workflow builds with a GitHub Pages `baseURL`; `hugo.toml` remains pointed at
the primary MeLE domain.

## MeLE

Create the host slot from `nixos-config` with `mele-app static create <site>`, then deploy this site's `public/` output to `/srv/static/<site>/current` using:

```bash
site:deploy:mele
```

Rollback to a known release:

```bash
site:rollback:mele --release <release-id>
```
