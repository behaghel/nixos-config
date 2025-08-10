## Emacs Configuration

For consistent Scala development using core Emacs functionality:

### Built-in Language Server (eglot)
```elisp
;; Scala development with eglot and Metals
(use-package eglot
  :hook (scala-mode . eglot-ensure)
  :config
  (add-to-list 'eglot-server-programs 
               '(scala-mode . ("metals"))))
```

### Formatting with built-in compile
```elisp
;; Format current buffer with scalafmt
(defun scala-format-buffer ()
  "Format current Scala buffer with scalafmt."
  (interactive)
  (when (eq major-mode 'scala-mode)
    (shell-command-on-region (point-min) (point-max) 
                             "scalafmt --stdin" 
                             (current-buffer) t)))

;; Bind to common formatting key
(define-key scala-mode-map (kbd "C-c f") #'scala-format-buffer)
```

### SBT Integration with built-in compile
```elisp
;; SBT compilation commands
(defun scala-sbt-compile ()
  "Compile Scala project with sbt."
  (interactive)
  (let ((default-directory (project-root (project-current))))
    (compile "sbt compile")))

(defun scala-sbt-test ()
  "Run sbt tests."
  (interactive)
  (let ((default-directory (project-root (project-current))))
    (compile "sbt test")))

(defun scala-sbt-run ()
  "Run Scala application with sbt."
  (interactive)
  (let ((default-directory (project-root (project-current))))
    (compile "sbt run")))

;; Key bindings
(define-key scala-mode-map (kbd "C-c c") #'scala-sbt-compile)
(define-key scala-mode-map (kbd "C-c t") #'scala-sbt-test)
(define-key scala-mode-map (kbd "C-c r") #'scala-sbt-run)
```

### REPL Integration with built-in inferior-process
```elisp
;; Scala REPL using sbt console
(defun scala-start-repl ()
  "Start Scala REPL using sbt console."
  (interactive)
  (let ((default-directory (project-root (project-current))))
    (run-scala "sbt console")))

(define-key scala-mode-map (kbd "C-c C-z") #'scala-start-repl)