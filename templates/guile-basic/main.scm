
#!/usr/bin/env guile
!#

;;; Main application entry point

(define-module (main)
  #:use-module (guile-basic hello)
  #:export (main))

(define (main args)
  "Main application entry point"
  (let ((name (if (> (length args) 1)
                  (cadr args)
                  "World")))
    (display (greet name))
    (newline)))

;; Run main if this file is executed directly
(when (string=? (car (command-line)) "main.scm")
  (main (command-line)))
