import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerEmacsTools } from "./tools.ts";

export default function emacsExtension(pi: ExtensionAPI) {
  registerEmacsTools(pi, Type);
}
