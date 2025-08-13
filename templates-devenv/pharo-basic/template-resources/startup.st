
"Startup script to load PharoBasic packages into the image using Metacello"

"Load project using Metacello baseline"
Metacello new
  baseline: 'PharoBasic';
  repository: 'tonel://src';
  load.

Transcript show: 'PharoBasic packages loaded successfully via Metacello!'; cr.
