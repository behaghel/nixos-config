
Class {
	#name : 'PharoBasicExampleTest',
	#superclass : 'TestCase',
	#category : 'PharoBasic-Tests'
}

{ #category : 'tests' }
PharoBasicExampleTest >> testGreet [
	"Test the greet method"
	| example result |
	example := PharoBasicExample new.
	result := example greet: 'Alice'.
	self assert: result equals: 'Hello, Alice!'
]

{ #category : 'tests' }
PharoBasicExampleTest >> testRun [
	"Test that run method works without errors"
	| example |
	example := PharoBasicExample new.
	self shouldnt: [ example run ] raise: Error
]
