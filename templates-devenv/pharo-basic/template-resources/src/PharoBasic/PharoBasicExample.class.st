
Class {
	#name : 'PharoBasicExample',
	#superclass : 'Object',
	#category : 'PharoBasic'
}

{ #category : 'public' }
PharoBasicExample >> greet: aName [
	"Return a greeting message for the given name"
	^ 'Hello, ', aName, '!'
]

{ #category : 'public' }
PharoBasicExample >> run [
	"Main entry point for the application"
	| greeting |
	greeting := self greet: 'Pharo World'.
	Transcript show: greeting; cr.
	^ greeting
]

{ #category : 'mathematics' }
PharoBasicExample >> fibonacci: n [
	"Calculate the nth Fibonacci number"
	n <= 1 ifTrue: [ ^ n ].
	^ (self fibonacci: n - 1) + (self fibonacci: n - 2)
]

{ #category : 'mathematics' }
PharoBasicExample >> factorial: n [
	"Calculate the factorial of n"
	n <= 1 ifTrue: [ ^ 1 ].
	^ n * (self factorial: n - 1)
]
