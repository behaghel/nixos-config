/**
 * UX Stories — pi extension
 *
 * Makes pi fluent in user-story-driven UX development: write stories, spec with
 * SVG wireframes, validate with BDD scenarios, deliver with BDD+TDD orchestration.
 *
 * What this extension provides:
 *   • Injects UX story expertise into the system prompt
 *   • Registers commands: /story-write, /story-scenarios, /story-deliver
 *   • Registers skill: story-writer
 *
 * For the companion skill, see ../skills/story-writer/SKILL.md
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function uxStoriesExtension(pi: ExtensionAPI) {
	const uxExpertise = `
## UX Stories (User-Story-Driven UX Development)

Every UX change starts from a user story, is specced visually with SVG wireframes, and validated with BDD scenarios.

### Core principles
1. **No UX code without a story** — every screen change traces back to a user story
2. **Wireframes are the visual spec** — precise SVG wireframes, not mockups
3. **BDD scenarios are the behavioral spec** — Given/When/Then from user perspective
4. **BDD wraps TDD** — BDD scenarios are outer test layer, TDD iterations inside

### Key commands:** /story-write, /story-scenarios, /story-deliver
**Skill:** story-writer
`;

	pi.on("before_agent_start", async (event) => {
		return {
			systemPrompt: `${event.systemPrompt}\n${uxExpertise}`,
		};
	});

	// Register commands
	pi.registerCommand("story-write", {
		description: "Write a user story with SVG wireframe and BDD scenarios",
		handler: async (args, ctx) => {
			if (!args.trim()) {
				ctx.ui.notify("Usage: /story-write <feature description>", "info");
				return;
			}
			pi.sendUserMessage(
				`Write a user story for: ${args.trim()}. Include personas, SVG wireframes, and BDD scenarios. ` +
				"Use the story-writer skill conventions."
			);
		},
	});

	pi.registerCommand("story-scenarios", {
		description: "Write BDD scenarios for an uncovered screen or flow",
		handler: async (args, ctx) => {
			if (!args.trim()) {
				ctx.ui.notify("Usage: /story-scenarios <screen or flow>", "info");
				return;
			}
			pi.sendUserMessage(
				`Write BDD scenarios for: ${args.trim()}. Cover happy path, edge cases, and error states. ` +
				"Use Gherkin conventions from the story-writer skill."
			);
		},
	});

	pi.registerCommand("story-deliver", {
		description: "Deliver a story through BDD+TDD orchestration",
		handler: async (args, ctx) => {
			if (!args.trim()) {
				ctx.ui.notify("Usage: /story-deliver <story-name>", "info");
				return;
			}
			pi.sendUserMessage(
				`Deliver the story: ${args.trim()}. Orchestrate BDD scenarios as outer tests, ` +
				"drive TDD iterations inside to make each scenario pass. " +
				"Use the BDD-TDD nesting pattern from the story-writer skill."
			);
		},
	});
}
