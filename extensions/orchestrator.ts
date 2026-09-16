import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Graph, NodeId } from "../src/types.ts";
import { graph } from "../src/graph.ts";
import { createRegisters, resetRegisters } from "../src/state.ts";
import { activeToolsFor, createRouteTool } from "../src/route-tool.ts";

export default function (pi: ExtensionAPI) {
	const state = createRegisters(graph);

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
}

function renderPersona(graph: Graph, node: NodeId): string {
	const p = graph.nodes[node];
	return `[current node: ${node}]\n${p.body}\navailable tools: ${p.tools.join(", ") || "(route only)"}`;
}
