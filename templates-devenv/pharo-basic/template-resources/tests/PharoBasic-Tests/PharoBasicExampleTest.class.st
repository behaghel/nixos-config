
Class {
	#name : 'PharoBasicExampleTest',
	#superclass : 'TestCase',
	#instVars : [
		'example'
	],
	#category : 'PharoBasic-Tests'
}

{ #category : 'running' }
PharoBasicExampleTest >> setUp [
	"Initialize test fixture"
	super setUp.
	example := PharoBasicExample new
]

{ #category : 'running' }
PharoBasicExampleTest >> tearDown [
	"Clean up test fixture"
	example := nil.
	super tearDown
]

{ #category : 'tests' }
PharoBasicExampleTest >> testGreet [
	"Test the greet method"
	| result |
	result := example greet: 'Alice'.
	self assert: result equals: 'Hello, Alice!'
]

{ #category : 'tests' }
PharoBasicExampleTest >> testGreetEmpty [
	"Test greeting with empty string"
	| result |
	result := example greet: ''.
	self assert: result equals: 'Hello, !'
]

{ #category : 'tests' }
PharoBasicExampleTest >> testFibonacci [
	"Test Fibonacci calculations"
	self assert: (example fibonacci: 0) equals: 0.
	self assert: (example fibonacci: 1) equals: 1.
	self assert: (example fibonacci: 5) equals: 5.
	self assert: (example fibonacci: 10) equals: 55
]

{ #category : 'tests' }
PharoBasicExampleTest >> testFactorial [
	"Test factorial calculations"
	self assert: (example factorial: 0) equals: 1.
	self assert: (example factorial: 1) equals: 1.
	self assert: (example factorial: 5) equals: 120.
	self assert: (example factorial: 6) equals: 720
]

{ #category : 'tests' }
PharoBasicExampleTest >> testRun [
	"Test the main run method"
	| result |
	result := example run.
	self assert: result equals: 'Hello, Pharo World!'
]
