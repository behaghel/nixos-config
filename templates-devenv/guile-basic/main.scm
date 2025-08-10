
#!/usr/bin/env guile
!#

(use-modules (guile-basic hello)
             (ice-9 getopt-long))

(define option-spec
  '((help (single-char #\h) (value #f))
    (name (single-char #\n) (value #t))))

(define (show-help)
  (display "Usage: guile -L . -s main.scm [OPTIONS]\n")
  (display "Options:\n")
  (display "  -h, --help     Show this help message\n")
  (display "  -n, --name     Name to greet (default: World)\n"))

(define (main args)
  (let* ((options (getopt-long args option-spec))
         (help-wanted (option-ref options 'help #f))
         (name (option-ref options 'name "World")))
    (if help-wanted
        (show-help)
        (display (string-append (greet name) "\n")))))

;; Run main when script is executed directly
(when (string=? (basename (car (command-line))) "main.scm")
  (main (command-line)))
