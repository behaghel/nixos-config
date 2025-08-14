"Setting up the basic tooling to get hacking."

| browser |
browser := ClyFullBrowserMorph openOnClass: PharoBasicExample .

"Open Test Runner and run PharoBasic tests"
| testRunner |
testRunner := DrTests open.

"Open Playground for interactive development"
| playground |
playground := StPlaygroundPresenter openContents: '|example |
example := PharoBasicExample new.
example greet: ''Developer''.
example run.
example fibonacci: 8.
example factorial: 5.'.