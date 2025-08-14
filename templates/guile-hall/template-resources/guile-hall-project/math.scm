
(define-module (guile-hall-project math)
  #:export (add subtract multiply divide factorial))

(define (add x y)
  "Add two numbers."
  (+ x y))

(define (subtract x y)
  "Subtract y from x."
  (- x y))

(define (multiply x y)
  "Multiply two numbers."
  (* x y))

(define (divide x y)
  "Divide x by y. Throws an error if y is zero."
  (if (= y 0)
      (error "Division by zero")
      (/ x y)))

(define (factorial n)
  "Calculate the factorial of n. Throws an error for negative numbers."
  (if (< n 0)
      (error "Factorial is not defined for negative numbers")
      (if (<= n 1)
          1
          (* n (factorial (- n 1))))))
