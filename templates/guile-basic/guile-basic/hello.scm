
;;; Hello world functionality module

(define-module (guile-basic hello)
  #:export (greet))

(define (greet . args)
  "Return a greeting message.
   With no arguments, greets 'World'.
   With one argument, greets that name."
  (let ((name (if (null? args) "World" (car args))))
    (string-append "Hello, " name "!")))
