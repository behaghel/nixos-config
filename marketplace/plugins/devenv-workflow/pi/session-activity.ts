import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

/** Record engagement through the CLI; never read Pi history or edit its bindings. */
export function registerSessionActivity(pi: ExtensionAPI, isActive: () => boolean): void {
	let warned = false;

	function warn(ctx: ExtensionContext, detail: string): void {
		if (warned) return;
		warned = true;
		const message = `agent-session activity touch could not record Pi activity. Check the project launcher/environment; no automatic upgrade was attempted.\n${detail}`;
		if (ctx.hasUI) ctx.ui.notify(message, "warning");
		else console.error(message);
	}

	async function record(ctx: ExtensionContext): Promise<void> {
		if (!isActive()) return;
		try {
			const result = await pi.exec("agent-session", [".", "activity", "touch"], {
				cwd: ctx.cwd, timeout: 5000, maxBuffer: 8192,
			});
			if (result.code === 0) return;
			// A devenv project need not be a managed worktree. The CLI still owns
			// binding validation; these expected refusals never trigger adoption.
			if (result.code === 1 && /(?:primary checkout has no current managed session|Current worktree (?:has no recorded managed session|is not a managed session))/.test(result.stderr)) return;
			warn(ctx, result.stderr.trim() || `Launcher exited with code ${result.code}.`);
		} catch (error) {
			warn(ctx, String(error));
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		warned = false;
		await record(ctx);
	});
	pi.on("message_end", async (event, ctx) => {
		const message = event.message;
		if (message.role === "user" || (message.role === "assistant" &&
			message.content.some((block) => block.type === "text" && block.text.trim().length > 0))) {
			await record(ctx);
		}
	});
}
