
(define-module (guile-hall-project math)
  #:export (add subtract multiply divide factorial))

(define (add x y)
  "Add two numbers together."
  (+ x y))

(define (subtract x y)
  "Subtract y from x."
  (- x y))

(define (multiply x y)
  "Multiply two numbers."
  (* x y))

(define (divide x y)
  "Divide x by y, with error handling for division by zero."
  (if (zero? y)
      (error "Division by zero")
      (/ x y)))

(define (factorial n)
  "Calculate factorial of n."
  (if (< n 0)
      (error "Factorial of negative number")
      (if (<= n 1)
          1
          (* n (factorial (- n 1))))))
