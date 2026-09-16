import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Graph, NodeId, Registers } from "./types.ts";
import { commitTransition } from "./state.ts";

/** route is always available; domain tools follow the persona whitelist. */
export function activeToolsFor(graph: Graph, node: NodeId): string[] {
	return ["route", ...graph.nodes[node].tools];
}

function exits(graph: Graph, node: NodeId): NodeId[] {
	return graph.edges.filter((e) => e.from === node).map((e) => e.to);
}

export function createRouteTool(pi: ExtensionAPI, graph: Graph, getReg: () => Registers) {
	return defineTool({
		name: "route",
		label: "Route",
		description:
			"Request a transition to the next node. target must be one of the exits declared for the current node. payload keys are merged into the orchestration state.",
		promptSnippet: "route(target, reason, payload?) - finish this node and move to the next one",
		promptGuidelines: [
			"After finishing all work for this node, call route exactly once.",
			"Do not end your reply without calling route.",
		],
		parameters: Type.Object({
			target: Type.String({ description: "Target node id" }),
			reason: Type.String({ description: "One-sentence reason for the transition" }),
			payload: Type.Optional(
				Type.Record(Type.String(), Type.Unknown(), {
					description: "Data to write into the orchestration state",
				}),
			),
		}),

		async execute(_id, args, _signal, _onUpdate, _ctx) {
			const state = getReg();
			const from = state.node;
			const edge = graph.edges.find((e) => e.from === from && e.to === args.target);
			// Illegal transition / guard rejection: throw. The harness turns the throw into an
			// isError tool result the model can read and reroute on. AgentToolResult has no
			// isError field, so throwing is the only way to surface a failure.
			if (!edge) {
				throw new Error(
					`illegal transition ${from} -> ${args.target}; declared exits: ${exits(graph, from).join(", ") || "(none)"}`,
				);
			}
			const verdict = edge.guard?.(state) ?? { ok: true as const };
			if (!verdict.ok) {
				throw new Error(`guard rejected ${from} -> ${args.target}: ${verdict.reason}`);
			}

			commitTransition(state, edge, args.payload, args.reason);
			pi.setActiveTools(activeToolsFor(graph, args.target)); // takes effect next turn
			pi.appendEntry("orch.transition", {
				from,
				to: args.target,
				reason: args.reason,
				facts: state.facts,
				ts: Date.now(),
			});

			const target = graph.nodes[args.target];
			return {
				content: [{ type: "text", text: `transitioned ${from} -> ${args.target}` }],
				details: { from, to: args.target, facts: state.facts },
				// Terminal only; otherwise the loop starts the next turn and the
				// context hook swaps in the new persona. No continuation machinery.
				...(target.terminal ? { terminate: true } : {}),
			};
		},
	});
}
