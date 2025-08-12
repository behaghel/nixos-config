
#!/usr/bin/env guile
!#

;;; Unit tests for the math module using SRFI-64

(use-modules (srfi srfi-64)           ; Testing framework
             (guile-hall-project math)) ; Module under test

;; Start the test suite
(test-begin "math-module-tests")

;; Test addition function
(test-group "addition-tests"
  (test-equal "add positive numbers"
    5
    (add 2 3))
  
  (test-equal "add negative numbers"
    -5
    (add -2 -3))
  
  (test-equal "add zero"
    7
    (add 7 0))
  
  (test-equal "add mixed signs"
    1
    (add 5 -4)))

;; Test subtraction function
(test-group "subtraction-tests"
  (test-equal "subtract positive numbers"
    2
    (subtract 5 3))
  
  (test-equal "subtract negative numbers"
    1
    (subtract -2 -3))
  
  (test-equal "subtract zero"
    7
    (subtract 7 0))
  
  (test-equal "subtract from zero"
    -5
    (subtract 0 5)))

;; Test multiplication function
(test-group "multiplication-tests"
  (test-equal "multiply positive numbers"
    15
    (multiply 3 5))
  
  (test-equal "multiply by zero"
    0
    (multiply 42 0))
  
  (test-equal "multiply negative numbers"
    15
    (multiply -3 -5))
  
  (test-equal "multiply mixed signs"
    -15
    (multiply 3 -5)))

;; Test division function
(test-group "division-tests"
  (test-equal "divide positive numbers"
    2
    (divide 10 5))
  
  (test-equal "divide with remainder (rational)"
    3/2
    (divide 3 2))
  
  (test-equal "divide negative numbers"
    2
    (divide -10 -5))
  
  (test-equal "divide by one"
    42
    (divide 42 1))
  
  ;; Test error handling for division by zero
  (test-error "divide by zero should throw error"
    #t
    (divide 5 0)))

;; Test factorial function
(test-group "factorial-tests"
  (test-equal "factorial of 0"
    1
    (factorial 0))
  
  (test-equal "factorial of 1"
    1
    (factorial 1))
  
  (test-equal "factorial of 5"
    120
    (factorial 5))
  
  (test-equal "factorial of 10"
    3628800
    (factorial 10))
  
  ;; Test error handling for negative numbers
  (test-error "factorial of negative number should throw error"
    #t
    (factorial -1)))

;; Test edge cases and boundary conditions
(test-group "edge-cases"
  (test-equal "very large numbers addition"
    2000000000
    (add 1000000000 1000000000))
  
  (test-equal "floating point division"
    2.5
    (divide 5.0 2.0)))

;; End the test suite
(test-end "math-module-tests")

;; Print test summary
(let ((runner (test-runner-current)))
  (format #t "~%Test Summary:~%")
  (format #t "  Tests run: ~a~%" (test-runner-test-count runner))
  (format #t "  Passes: ~a~%" (test-runner-pass-count runner))
  (format #t "  Failures: ~a~%" (test-runner-fail-count runner))
  (format #t "  Errors: ~a~%" (test-runner-xfail-count runner))
  
  ;; Exit with appropriate code
  (exit (if (and (zero? (test-runner-fail-count runner))
                 (zero? (test-runner-xfail-count runner)))
            0
            1)))
