
#!/usr/bin/env guile
!#

;;; Main application entry point for guile-hall project

(use-modules (ice-9 getopt-long)
             (ice-9 format))

;; Note: After hall initialization, you can import your project modules like:
;; (use-modules (guile-hall-project))

(define (main args)
  "Main entry point for the application."
  (let* ((option-spec '((version (single-char #\v) (value #f))
                        (help    (single-char #\h) (value #f))))
         (options (getopt-long args option-spec)))
    
    (cond
     ((option-ref options 'version #f)
      (format #t "guile-hall-project version 0.1.0~%"))
     
     ((option-ref options 'help #f)
      (format #t "Usage: ~a [OPTIONS]~%" (car args))
      (format #t "  -h, --help     Show this help message~%")
      (format #t "  -v, --version  Show version information~%"))
     
     (else
      (format #t "Hello from Guile Hall project!~%")
      (format #t "Run 'hall build' to initialize the project structure.~%")))))

;; Run main when script is executed directly
(when (equal? (car (command-line)) (car (program-arguments)))
  (main (command-line)))
