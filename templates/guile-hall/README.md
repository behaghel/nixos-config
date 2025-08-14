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

For consistent Guile development using core Emacs functionality with Geiser:

### Geiser Integration
```elisp
;; Geiser for interactive Guile development
(use-package geiser
  :hook (scheme-mode . geiser-mode))

(use-package geiser-guile
  :config
  (setq geiser-guile-load-path '(".")
        geiser-guile-init-file nil))

;; Key bindings for Geiser
(with-eval-after-load 'geiser-mode
  (define-key geiser-mode-map (kbd "C-c C-z") #'geiser)
  (define-key geiser-mode-map (kbd "C-c C-k") #'geiser-eval-buffer)
  (define-key geiser-mode-map (kbd "C-c C-e") #'geiser-eval-last-sexp))
```

### Hall Project Integration
```elisp
;; Hall project commands using built-in compile
(defun guile-hall-build ()
  "Build Guile Hall project."
  (interactive)
  (let ((default-directory (project-root (project-current))))
    (compile "hall build")))

(defun guile-hall-test ()
  "Run Guile Hall tests."
  (interactive)
  (let ((default-directory (project-root (project-current))))
    (compile "hall test")))

(defun guile-hall-dist ()
  "Create Guile Hall distribution."
  (interactive)
  (let ((default-directory (project-root (project-current))))
    (compile "hall dist")))

;; Key bindings for Hall
(define-key scheme-mode-map (kbd "C-c b") #'guile-hall-build)
(define-key scheme-mode-map (kbd "C-c t") #'guile-hall-test)
(define-key scheme-mode-map (kbd "C-c d") #'guile-hall-dist)
```

### Built-in Compilation for Linting
```elisp
;; Guild compilation for linting
(defun guile-compile-file ()
  "Compile current Guile file with Guild."
  (interactive)
  (when (eq major-mode 'scheme-mode)
    (let ((default-directory (project-root (project-current))))
      (compile (format "guild compile -Warity-mismatch -Wformat -Wunbound-variable %s"
                       (file-name-nondirectory buffer-file-name))))))

(define-key scheme-mode-map (kbd "C-c c") #'guile-compile-file)
```

### Formatting and Indentation
```elisp
;; Scheme formatting conventions
(add-hook 'scheme-mode-hook
          (lambda ()
            (setq-local indent-tabs-mode nil)
            (setq-local tab-width 2)
            (setq-local lisp-indent-offset 2)))

;; Format buffer using built-in indentation
(defun scheme-format-buffer ()
  "Format current Scheme buffer."
  (interactive)
  (when (eq major-mode 'scheme-mode)
    (indent-region (point-min) (point-max))))

(define-key scheme-mode-map (kbd "C-c f") #'scheme-format-buffer)