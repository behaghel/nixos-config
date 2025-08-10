
#!/usr/bin/env guile
!#

(use-modules (srfi srfi-64)
             (guile-basic hello))

(test-begin "guile-basic-tests")

(test-equal "Basic greeting"
  "Hello, World!"
  (greet))

(test-equal "Custom greeting"
  "Hello, Alice!"
  (greet "Alice"))

(test-end "guile-basic-tests")
