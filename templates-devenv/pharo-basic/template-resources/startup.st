
"Startup script to load PharoBasic packages into the image"

"Load the main package"
(FileSystem workingDirectory / 'src' / 'PharoBasic' / 'package.st') exists
  ifTrue: [
    Metacello new
      baseline: 'PharoBasic';
      repository: 'tonel://src';
      load.
  ]
  ifFalse: [
    "Fallback: load files directly if no baseline"
    | srcDir |
    srcDir := FileSystem workingDirectory / 'src' / 'PharoBasic'.
    srcDir exists ifTrue: [
      srcDir children
        select: [ :file | file extension = 'st' and: [ file basename ~= 'package.st' ] ]
        thenDo: [ :file | 
          Transcript show: 'Loading ', file basename; cr.
          file readStream fileIn.
        ].
    ].
  ].

"Load the test package"
(FileSystem workingDirectory / 'tests' / 'PharoBasic-Tests' / 'package.st') exists
  ifTrue: [
    | testDir |
    testDir := FileSystem workingDirectory / 'tests' / 'PharoBasic-Tests'.
    testDir children
      select: [ :file | file extension = 'st' and: [ file basename ~= 'package.st' ] ]
      thenDo: [ :file | 
        Transcript show: 'Loading ', file basename; cr.
        file readStream fileIn.
      ].
  ].

Transcript show: 'PharoBasic packages loaded successfully!'; cr.
