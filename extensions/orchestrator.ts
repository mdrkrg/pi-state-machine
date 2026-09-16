import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Graph, NodeId } from "../src/types.ts";
import { graph } from "../src/graph.ts";
import { createRegisters, resetRegisters } from "../src/state.ts";
import { activeToolsFor, createRouteTool } from "../src/route-tool.ts";
import { mockTools } from "../src/mocks.ts";

export default function (pi: ExtensionAPI) {
	const state = createRegisters(graph);

	for (const t of mockTools(pi)) pi.registerTool(t);
	pi.registerTool(createRouteTool(pi, graph, () => state));
	pi.registerCommand("orch:state", {
		description: "Print current orchestration state",
		handler: async (_args, ctx) => {
			ctx.ui.notify(JSON.stringify(state, null, 2), "info");
		},
	});

	// Session boundary: reset state and install the entry tool set.
	pi.on("session_start", () => {
		resetRegisters(state, graph);
		pi.setActiveTools(activeToolsFor(graph, graph.entry));
	});

	// Before each LLM call: append the current node persona at the message tail.
	// The transform is request-local (never written to the transcript), so every
	// call sees the current node's persona without any dedup logic, and entry /
	// later nodes share the same injection path.
	pi.on("context", (event) => ({
		messages: [
			...event.messages,
			{
				role: "custom" as const,
				customType: "orch.persona",
				content: [{ type: "text" as const, text: renderPersona(graph, state.node) }],
				display: false,
				timestamp: Date.now(),
			},
		],
	}));

	// HITL gate on world writes. Approval is state, not atmosphere: the
	// publish -> done guard consumes facts.approved.
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "publish_external") return;
		if (!ctx.hasUI) {
			return { block: true, reason: "no UI environment; world writes are denied by default" };
		}
		const ok = await ctx.ui.confirm("Publish to the external system?", JSON.stringify(event.input, null, 2));
		if (!ok) return { block: true, reason: "user declined the publication" };
		state.facts.approved = true;
	});
}

function renderPersona(graph: Graph, node: NodeId): string {
	const p = graph.nodes[node];
	return `[current node: ${node}]\n${p.body}\navailable tools: ${p.tools.join(", ") || "(route only)"}`;
}
