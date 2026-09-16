import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

// In-memory workspace shared by the mock domain tools. Session-lifetime only.
const workspace: { doc: string } = { doc: "" };

export function mockTools(_pi: ExtensionAPI) {
	return [
		defineTool({
			name: "read_workspace",
			label: "Read Workspace",
			description: "Read the current workspace document (mock).",
			promptSnippet: "read_workspace() - read the workspace document",
			parameters: Type.Object({}),
			async execute() {
				return {
					content: [{ type: "text", text: workspace.doc || "(workspace is empty)" }],
					details: {},
				};
			},
		}),
		defineTool({
			name: "write_workspace",
			label: "Write Workspace",
			description: "Replace the workspace document (mock).",
			promptSnippet: "write_workspace(content) - replace the workspace document",
			parameters: Type.Object({
				content: Type.String({ description: "Full document text" }),
			}),
			async execute(_id, args) {
				workspace.doc = args.content;
				return {
					content: [{ type: "text", text: "written" }],
					details: { bytes: args.content.length },
				};
			},
		}),
		defineTool({
			name: "publish_external",
			label: "Publish External",
			description: "Publish the given content to the external system (mock).",
			promptSnippet: "publish_external(content) - publish content to the external system",
			parameters: Type.Object({
				content: Type.String({ description: "Content to publish" }),
			}),
			async execute(_id, args) {
				return {
					content: [{ type: "text", text: "published" }],
					details: { bytes: args.content.length },
				};
			},
		}),
	];
}
