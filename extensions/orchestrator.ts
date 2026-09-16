import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

const echoTool = defineTool({
	name: "echo",
	label: "Echo",
	description: "Echo the given text back. Test tool.",
	promptSnippet: "echo(text) — echo text back",
	parameters: Type.Object({
		text: Type.String({ description: "Text to echo" }),
	}),
	async execute(_id, args) {
		return {
			content: [{ type: "text", text: args.text }],
			details: {},
		};
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(echoTool);
	pi.on("session_start", () => {
		pi.setActiveTools(["echo", "read"]);
	});
}
