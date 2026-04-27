/**
 * Spec-TDD — pi extension
 *
 * Makes pi fluent in iterative vertical-slice TDD: plan implementation from specs,
 * execute red-green-refactor iterations with human feedback at every checkpoint.
 *
 * What this extension provides:
 *   • Injects TDD expertise into the system prompt
 *   • Registers commands: /tdd-plan, /tdd-iterate
 *   • Registers skill: tdd-planner
 *
 * For the companion skill, see ../skills/tdd-planner/SKILL.md
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function specTddExtension(pi: ExtensionAPI) {
	const tddExpertise = `
## Spec-TDD (Iterative Vertical-Slice TDD)

Plan and execute implementation from specs using strict red-green-refactor discipline.

### Workflow
1. **Plan** — Identify acceptance criteria from spec, propose ordered vertical-slice iterations
2. **Iterate** — One slice at a time: write failing test → make it pass → refactor
3. **Verify** — Human checkpoints at each iteration

Each iteration starts with the smallest viable end-to-end slice (happy path) and adds complexity.

**Key commands:** /tdd-plan, /tdd-iterate
**Skill:** tdd-planner
`;

	pi.on("before_agent_start", async (event) => {
		return {
			systemPrompt: `${event.systemPrompt}\n${tddExpertise}`,
		};
	});

	// Register commands
	pi.registerCommand("tdd-plan", {
		description: "Plan vertical-slice iterations from a spec",
		handler: async (args, ctx) => {
			if (!args.trim()) {
				ctx.ui.notify("Usage: /tdd-plan <path-to-spec.md>", "info");
				return;
			}
			pi.sendUserMessage(
				`Plan vertical-slice iterations for the spec at ${args.trim()}. ` +
				"Identify acceptance criteria, propose ordered iterations starting with the happy path, " +
				"and define slice goals. Use the tdd-planner skill for detailed guidance."
			);
		},
	});

	pi.registerCommand("tdd-iterate", {
		description: "Execute one TDD iteration",
		handler: async (args, ctx) => {
			if (!args.trim()) {
				ctx.ui.notify("Usage: /tdd-iterate <iteration-description or 'continue'>", "info");
				return;
			}
			pi.sendUserMessage(
				`Execute the TDD iteration: ${args.trim()}. ` +
				"Follow strict red-green-refactor. Start with the test, make it pass with minimal code, " +
				"then refactor. Ask for human checkpoint before proceeding."
			);
		},
	});
}
