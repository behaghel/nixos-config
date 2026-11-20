import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const dimensions = {
  all: "efficiency, quality, and architecture",
  efficiency: "efficiency",
  quality: "quality",
  arch: "architecture",
};

export default function sessionReflection(pi: ExtensionAPI) {
  // Resolve against the package, never the invoking project's working directory.
  const skill = readFileSync(new URL("../skills/session-reflection/SKILL.md", import.meta.url), "utf8");
  for (const [command, selected] of Object.entries(dimensions)) {
    pi.registerCommand(`reflect:${command}`, {
      description: `Reflect on ${selected} from this coding session`,
      handler: async (args) => {
        pi.sendUserMessage([
          "Reflect on this coding-agent session in the current project.",
          `Requested dimensions: ${selected}.`,
          "Follow the bundled session-reflection skill below:",
          "",
          skill,
          "",
          "Offer to draft GitHub issues for findings I select; do not create any without showing the final draft and obtaining explicit approval.",
          ...(args.trim() ? ["", `Additional user focus: ${args.trim()}`] : []),
        ].join("\n"), { deliverAs: "followUp" });
      },
    });
  }
}
