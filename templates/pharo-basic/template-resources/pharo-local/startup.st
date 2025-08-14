"Setting up the basic tooling to get hacking."

ClyFullBrowserMorph openOnClass: PharoBasicExample .

DrTests open.

StPlaygroundPresenter openContents: '|example |
example := PharoBasicExample new.
example greet: ''Developer''.
example run.
example fibonacci: 8.
example factorial: 5.'.