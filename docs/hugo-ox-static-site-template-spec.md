# Spec: Hugo ox-hugo Static Site Template

## Problem
Creating new personal static websites should be fast, consistent, and compatible with the MeLE static-site host workflow. The current reference site, `~/ws/blog.behaghel.org`, proves the Org → ox-hugo → Hugo pattern, but it is too old and too blog-specific to copy wholesale. A new template should provide a lean starting point for many future static websites while preserving the high-convenience Emacs/Denote authoring workflow.

## Context
- Existing templates live under `templates/` and are exposed through flake template outputs.
- The new MeLE static-site host concept serves Caddy `file_server` roots under `/srv/static/<site>/current` and provides `mele-app create --static <site>` for host slot creation.
- `~/ws/blog.behaghel.org` currently uses:
  - Hugo with `config.toml`;
  - Org sources in `content-org/`;
  - ox-hugo generated Markdown in `content/`;
  - `.dir-locals.el` to set `denote-directory`, `denote-prompts`, `org-hugo-base-dir`, and auto-export behavior;
  - committed Org and generated Markdown;
  - uncommitted `public/` build output.
- Modern Hugo guidance favors `hugo.toml`, minimal config, `assets/` for pipeline resources, `static/` for passthrough files, Hugo Modules/themes when needed, and production builds with `hugo --gc --minify`.
- The focused `.emacs.d` work proposes per-site `.dir-locals.el` using `hb-static-site-mode`.

## Decisions
| Decision | Choice | Rationale |
|----------|--------|-----------|
| Audience | Personal-first template | Optimizes for Hubert’s repeated workflow without premature generalization. |
| Template name | `hugo-ox-static-site` | Clear and specific to Hugo + ox-hugo. |
| Hugo scaffold | Minimal theme-less built-in layouts | Builds reliably without selecting a theme; future sites can add standard themes. |
| Config file | `hugo.toml` only | Avoid duplicate `site.toml`; Hugo already owns `baseURL`, title, language, and params. |
| MeLE config | `[params.mele]` in `hugo.toml` | Keeps deploy metadata near site metadata. |
| Content model | Mixed pages + Denote posts | `content-org/pages/` for stable pages; Denote-oriented `content-org/posts/` for posts. |
| Generated Markdown | Commit `content/*.md` | CI and deploys do not require Emacs/ox-hugo. |
| Public output | Do not commit `public/` | It is build/deploy output. |
| Org export | Emacs auto-export primary; build does not require Emacs | Preserves convenience while keeping CI simple. |
| Emacs integration | Shared `~/.emacs.d` module contract only | Template should not vendor personal Emacs module code. |
| `.dir-locals.el` | Graceful `hb-static-site-mode` fallback | Works when module is loaded and degrades when absent. |
| Devenv tasks | Include MeLE project-side tasks | This template is phase 2 of the MeLE static-site workflow. |
| GitHub Pages | Include Actions workflow and `github:setup` from day one | Provides backup static hosting from the same source and one-command setup. |
| Analytics | Disabled extension point only | Future Analyzati integration can be added without host-side monitoring. |
| Comments/social | Excluded in v1 | Keeps template lean. |

## Expected Template Structure
```text
hugo-ox-static-site/
  .dir-locals.el
  .editorconfig
  .envrc
  .gitignore
  README.md
  devenv.nix
  devenv.yaml
  hugo.toml
  content-org/
    pages/
      _index.org
      about.org
    posts/
      .keep
  content/
    _index.md
    about.md
  layouts/
    _default/
      baseof.html
      list.html
      single.html
    index.html
    partials/
      analytics.html
      footer.html
      head.html
  assets/
    css/
      main.scss
      semantic/
        _tokens.scss
        _base.scss
        _images.scss
        _blocks.scss
        _code.scss
  static/
    .keep
  .github/
    workflows/
      pages.yml
```

## Template Configuration
`hugo.toml` should derive all MeLE defaults from the single placeholder `example`.
Omnix should ask only for `site-name`; replacing `example` with that value yields
both the subdomain and the deploy root.

```toml
baseURL = "https://example.home.behaghel.org/"
title = "example"
locale = "en"

[params]
description = "A personal static site."

[params.mele]
site = "example"
host = "hub@mele"
root = "/srv/static/example"

[params.analytics]
enable = false
```

## Emacs Contract
The template does not implement Emacs behavior. It expects a personal Emacs module to provide `hb-static-site-mode`.

The generated `.dir-locals.el` should use this pattern:

```elisp
((nil . ((denote-directory . "content-org")
         (denote-prompts . (subdirectory title keywords))
         (org-hugo-base-dir . ".")))
 ("content-org/" . ((org-mode . ((eval . (when (fboundp 'hb-static-site-mode)
                                           (hb-static-site-mode))))))))
```

Desired behavior of the external Emacs module:
- enable ox-hugo conveniences for site buffers;
- support Denote-created posts under `content-org/posts/`;
- support stable pages under `content-org/pages/`;
- provide commands for export/validation from Emacs;
- avoid hardcoding a specific website path.

## Devenv Task Contract
The template should provide these tasks:

| Task | Behavior |
|------|----------|
| `site:build` | Run `hugo --gc --minify`; does not require Emacs. |
| `site:serve` | Run Hugo local development server with drafts enabled. |
| `site:doctor` | Check `hugo.toml`, required dirs, resolved Hugo config, production build to temp dir, MeLE SSH reachability, and warn about dirty `content-org/`/`content/`. |
| `site:deploy:mele` | Build, copy `public/` to a new `/srv/static/<site>/releases/<release-id>/`, atomically update `current`, print URL. |
| `site:rollback:mele` | List or select previous release and repoint `current`. |
| `github:setup` | Initialize local git when needed, create/push GitHub repo with `gh`, configure Pages Actions, wait for workflow, and open the Pages URL. |

The deploy tasks should read site metadata from `hugo.toml`, not a separate `site.toml`.

`enterShell` should print a short, practical welcome message with the project lifecycle: write Org, commit generated Markdown, build, doctor, deploy, rollback, and edit `hugo.toml`.

## GitHub Pages Contract
The template should include `.github/workflows/pages.yml` using GitHub Pages Actions mode:
- checkout source;
- install/use Nix + devenv for consistency;
- run the Hugo production build;
- upload `public/` with `actions/upload-pages-artifact`;
- deploy with `actions/deploy-pages`;
- require Pages permissions (`pages: write`, `id-token: write`).

CI does not run ox-hugo export in v1; committed Markdown is the build input. The workflow should override Hugo `baseURL` to the GitHub Pages URL (`https://<owner>.github.io/<repo>/`) so the backup host has correct links and assets.

## Acceptance Criteria
- [ ] AC-1: Given the template is exposed through flake outputs, when `nix flake new my-site --template .#hugo-ox-static-site` is run, then a new project is created with Hugo, devenv, Org source, generated Markdown, layouts, and GitHub Pages workflow files.
- [ ] AC-2: Given a generated project, when `devenv -q shell -- hugo --gc --minify` runs, then the site builds successfully into `public/` without requiring Emacs.
- [ ] AC-3: Given a generated project, when `devenv -q shell -- devenv tasks run site:build` runs, then Hugo production build succeeds.
- [ ] AC-3a: Given a developer enters the devenv shell, when `enterShell` runs, then it prints a concise lifecycle message listing write/build/check/deploy/rollback commands.
- [ ] AC-4: Given a generated project, when `devenv -q shell -- devenv tasks run site:doctor` runs with MeLE reachable, then it validates Hugo config/build and SSH reachability; when MeLE is not reachable, it reports a clear diagnostic.
- [ ] AC-5: Given `hugo.toml` contains `[params.mele]`, when `site:deploy:mele` runs, then it deploys `public/` to `/srv/static/<site>/releases/<release-id>/` on `params.mele.host` and atomically updates `/srv/static/<site>/current`.
- [ ] AC-6: Given multiple releases exist on MeLE, when `site:rollback:mele` runs, then it can repoint `current` to a previous release without rebuilding the site.
- [ ] AC-7: Given the generated `.dir-locals.el` is loaded in Emacs without the personal module available, then it does not error; with `hb-static-site-mode` available, it enables the shared static-site behavior.
- [ ] AC-8: Given the generated project has starter Org content, when Hugo builds from committed Markdown, then the starter pages render.
- [ ] AC-9: Given GitHub Pages is configured to use Actions, when the workflow runs on `main`, then it builds and deploys the static site artifact with a GitHub Pages `baseURL`.
- [ ] AC-9a: Given `gh` is authenticated, when `github:setup` runs, then it initializes git if needed, creates a public GitHub repo by default, pushes `main`, attempts to configure Pages for Actions, waits for the workflow unless `--no-wait`, and opens the Pages URL unless `--no-open`.
- [ ] AC-10: Given template validation tests run in this repository, then the new template is included in the template test suite.

## Invariants
- `public/` must be gitignored.
- The template must not require Emacs, ox-hugo, or Denote in CI/build/deploy paths.
- The template must not include the full `blog.behaghel.org` theme/assets/layouts.
- The template must not include comments, webmentions, social sharing, or enabled analytics in v1.
- The template must not run MeLE activation or any sudo command.
- Deploy artifacts on MeLE remain outside Restic backup scope by default.

## Scope
**May modify:**
- `templates/hugo-ox-static-site/**`
- `templates/README.md`
- flake template registration files, likely `modules/flake/templates.nix`
- template tests under `tests/`
- this spec file

**Must not modify:**
- `~/.emacs.d` in this change
- existing blog repo files
- MeLE host static-site command/module except for docs links if needed
- unrelated templates beyond registration/docs tables

## Verification Plan
| Criterion | Method | Automated? |
|-----------|--------|------------|
| AC-1 | `nix flake new` from template in temp dir | Yes |
| AC-2, AC-3 | Run Hugo build and `site:build` in generated project | Yes |
| AC-4 | Run `site:doctor` with SSH mocked/skipped or documented manual check | Partial |
| AC-5, AC-6 | Unit/shell test deploy logic with temp remote directory or documented manual acceptance | Partial |
| AC-7 | Static inspection of `.dir-locals.el`; manual Emacs validation | Partial |
| AC-8 | Inspect generated `public/` for starter pages | Yes |
| AC-9 | Workflow syntax/static inspection; real GitHub run after project creation | Partial |
| AC-10 | Existing template validation suite updated | Yes |

## References
- `~/ws/blog.behaghel.org/.dir-locals.el`
- `~/ws/blog.behaghel.org/config.toml`
- `~/ws/blog.behaghel.org/README.org`
- `docs/mele-static-sites-spec.md`
- `docs/mele-static-sites.md`
- Hugo docs: configuration, directory structure, modules, GitHub Pages deployment
- devenv docs: tasks and packages
