# workon prompt tags

`workon` projects can opt into prompt context with a project-local `.workonrc`.
The prompt renders tags as `:tag1:tag2:` on the first line.

## `.workonrc` keys

```sh
ASSIST_CMD=claude
WORKON_TAG_RULES="env:CACHET_ENV cloud:gcloud mele"
```

`WORKON_TAG_RULES` is data-only. Logic lives in this repository's workon shell
framework, not in project scripts.

## Tag rules

| Rule | Tag emitted | Notes |
| --- | --- | --- |
| `env:VAR` | value of `$VAR`, e.g. `:dev:` | Empty env vars emit no tag. |
| `cloud:gcloud` | active GCP project as `:gcp/<project>:` | Reads the active gcloud config only for opted-in projects. |
| `mele` | `:mele:` | Detected by scanning project config for MeLE/devenv markers. |

Runtime tags:

| Context | Tag emitted |
| --- | --- |
| Python virtualenv/Conda active inside a `.workonrc` project | `:py/<env-name>:` |

Tags are de-duplicated in order. `:` inside tag values is replaced with `-`;
`/` is preserved, so cloud tags can look like `:gcp/cachet-staging:`.

Project capability checks, such as `mele`, are cached per project root to keep
prompt rendering fast. Dynamic runtime checks, such as env vars, active gcloud
project, and Python environment, are refreshed before each prompt.

## Nix/devenv shell marker

The command character becomes `❄` only when the current shell is inside an
active Nix/devenv shell, not merely because the directory contains `devenv.nix`.
Otherwise the default prompt character is `❯`.

The old separate Starship slots for `nix_shell`, `python`, and `gcloud` are
disabled to keep environment context in one place.
