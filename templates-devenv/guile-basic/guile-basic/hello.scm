
(define-module (guile-basic hello)
  #:export (greet))

(define* (greet #:optional (name "World"))
  "Greet someone with a friendly message."
  (format #f "Hello, ~a!" name))
