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

- `C-c w s` creates section indexes.
- `C-c w p` creates leaf-bundle pages, e.g. `content-org/howtos/grill/index.org`.
- `C-c w P` creates flat pages when you do not need page-owned resources.
- `C-c w n` creates Denote posts under `content-org/posts/`.
- Generated Hugo Markdown lives under `content/` and is committed.
- `public/` is build output and is ignored.

Normal builds and CI use the committed Markdown and do not require Emacs.

## Images and semantic styling

Use `assets/img/...` for shared images Hugo may process, page-bundle-local files
for images owned by one page, and `static/...` for raw files copied unchanged.
Responsive processing is explicit: add the `responsive` class.

```org
#+attr_html: :class fullwidth responsive
[[/img/shared.jpg]]

#+attr_html: :class small right responsive
[[local-page-image.jpg]]
```

Supported image classes are `responsive`, `small`, `fullwidth`, `right`, and
`centered`. The template also includes safe default SCSS for semantic blocks such
as `standfirst`, `epigraph`, `callout`, legacy `encart`, and `two-axis-table`.

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

Create the host slot from `nixos-config` with `mele-app create --static <site>`, then deploy this site's `public/` output to `/srv/static/<site>/current` using:

```bash
site:deploy:mele
```

Rollback to a known release:

```bash
site:rollback:mele --release <release-id>
```
