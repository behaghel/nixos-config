
"Startup script to load PharoBasic packages into the image"

"Load project using Metacello baseline - both main and test packages are in src/"
Metacello new
  baseline: 'PharoBasic';
  repository: 'tonel://src';
  load.

