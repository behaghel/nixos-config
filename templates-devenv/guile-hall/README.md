### Linting
- **Guild compiler** - Static analysis with warnings (`-Warity-mismatch`, `-Wformat`, `-Wunbound-variable`)
- **`devenv shell lint`** - Lint all source files automatically

### Formatting
- **Manual formatting** - Guile follows Lisp formatting conventions
- **`devenv shell format`** - Display formatting guidelines

### REPL Support
- **Guile REPL** - Interactive development with module loading (`devenv shell repl`)

## Environment Management

This template uses devenv for reproducible development environments:

- **devenv** provides consistent tooling across machines
- **direnv** automatically loads the environment when entering the directory
- **GUILE_LOAD_PATH** configured to include project modules

## Emacs Configuration

For consistent linting and formatting in Emacs, add this to your configuration:

### Linting with Flycheck
```elisp
;; Enable flycheck for Scheme files
(use-package flycheck
  :hook (scheme-mode . flycheck-mode))

;; Configure Guild for Guile linting
(flycheck-define-checker guile-guild
  "A Guile checker using Guild compiler."
  :command ("guild" "compile" 
            "-Warity-mismatch" "-Wformat" "-Wunbound-variable"
            source-inplace)
  :error-patterns
  ((warning line-start (file-name) ":" line ":" column ": warning: " (message) line-end)
   (error line-start (file-name) ":" line ":" column ": error: " (message) line-end))
  :modes scheme-mode)

(add-to-list 'flycheck-checkers 'guile-guild)
```

### Formatting with Geiser
```elisp
;; Geiser configuration for Guile development
(use-package geiser-guile
  :config
  (setq geiser-guile-load-path '(".")))

;; Automatic indentation for Scheme
(add-hook 'scheme-mode-hook
          (lambda ()
            (setq-local indent-tabs-mode nil)
            (setq-local tab-width 2)
            (setq-local lisp-indent-offset 2)))

;; Auto-format on save (optional)
(add-hook 'scheme-mode-hook
          (lambda ()
            (add-hook 'before-save-hook 'indent-region nil t)))