
Class {
	#name : 'BaselineOfPharoBasic',
	#superclass : 'BaselineOf',
	#category : 'BaselineOfPharoBasic'
}

{ #category : 'baseline' }
BaselineOfPharoBasic >> baseline: spec [
	<baseline>
	spec
		for: #common
		do: [
			"Define packages"
			spec
				package: 'PharoBasic';
				package: 'PharoBasic-Tests' with: [ spec requires: #('PharoBasic') ].
			
			"Define groups"
			spec
				group: 'Core' with: #('PharoBasic');
				group: 'Tests' with: #('PharoBasic-Tests');
				group: 'default' with: #('Core' 'Tests')
		]
]
