
#!/usr/bin/env guile
!#

;;; Test runner for the Guile project

(use-modules (srfi srfi-64)  ; Testing framework
             (guile-basic hello))

;; Test suite for hello module
(test-begin "hello-tests")

(test-equal "greet with no arguments"
  "Hello, World!"
  (greet))

(test-equal "greet with name"
  "Hello, Alice!"
  (greet "Alice"))

(test-equal "greet with empty string"
  "Hello, !"
  (greet ""))

(test-equal "greet with special characters"
  "Hello, Guile!"
  (greet "Guile"))

(test-end "hello-tests")

;; Exit with appropriate code
(exit (if (zero? (test-runner-fail-count (test-runner-current)))
          0
          1))
