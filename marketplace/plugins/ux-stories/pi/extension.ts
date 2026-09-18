/**
 * UX Stories — pi extension
 *
 * Makes pi fluent in user-story-driven graphical UX development: write stories,
 * spec with SVG wireframes, validate with BDD scenarios, and deliver with
 * BDD+TDD orchestration.
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
## UX Stories (Graphical User-Story-Driven Development)

Use this workflow only for graphical, screen-based interfaces such as web, mobile, and desktop UI. Every graphical UX change starts from a user story, is specced visually with SVG wireframes, and is validated with BDD scenarios.

Do not use this workflow for CLI, API, CI/CD, repository automation, reports, chat/email output, or non-graphical developer tooling. Use spec-driven command/output or request/response examples and spec-tdd executable tests instead. Gherkin is optional there; SVG wireframes are inappropriate.

### Core principles
1. **No graphical UX code without a story** — every screen change traces back to a user story
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
		description: "Write a graphical UX story with SVG wireframes and BDD scenarios",
		handler: async (args, ctx) => {
			if (!args.trim()) {
				ctx.ui.notify("Usage: /story-write <feature description>", "info");
				return;
			}
			pi.sendUserMessage(
				`Write a graphical UX story for: ${args.trim()}. First reject or redirect the request if it is not a screen-based interface. Include personas, SVG wireframes, and BDD scenarios. ` +
				"Use the story-writer skill conventions."
			);
		},
	});

	pi.registerCommand("story-scenarios", {
		description: "Write BDD scenarios for an uncovered graphical screen or flow",
		handler: async (args, ctx) => {
			if (!args.trim()) {
				ctx.ui.notify("Usage: /story-scenarios <screen or flow>", "info");
				return;
			}
			pi.sendUserMessage(
				`Write BDD scenarios for the graphical screen or flow: ${args.trim()}. Redirect non-graphical surfaces to spec-driven/spec-tdd. Cover happy path, edge cases, and error states. ` +
				"Use Gherkin conventions from the story-writer skill."
			);
		},
	});

	pi.registerCommand("story-deliver", {
		description: "Deliver a graphical UX story through BDD+TDD orchestration",
		handler: async (args, ctx) => {
			if (!args.trim()) {
				ctx.ui.notify("Usage: /story-deliver <story-name>", "info");
				return;
			}
			pi.sendUserMessage(
				`Deliver the graphical UX story: ${args.trim()}. Redirect non-graphical surfaces to spec-driven/spec-tdd. Orchestrate BDD scenarios as outer tests, ` +
				"drive TDD iterations inside to make each scenario pass. " +
				"Use the BDD-TDD nesting pattern from the story-writer skill."
			);
		},
	});
}
