
"Startup script to load PharoBasic packages into the image using Metacello"

"Load project using Metacello baseline"
Metacello new
  baseline: 'PharoBasic';
  filetreeDirectory: '.';
  load.


Transcript show: 'PharoBasic packages loaded successfully via Metacello\!'; cr.
