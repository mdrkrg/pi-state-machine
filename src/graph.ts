import type { Edge, Graph, NodeId, NodeSpec } from "./types.ts";
import { defineGraph } from "./graph-def.ts";
import { loadPersonas } from "./personas.ts";
import { atLeast, below, both, exists } from "./guards.ts";

const topology = {
	entry: "intake",
	nodes: {
		intake: { id: "intake" },
		research: { id: "research" },
		draft: { id: "draft" },
		review: { id: "review" },
		publish: { id: "publish" },
		done: { id: "done", terminal: true },
		escalate: { id: "escalate", terminal: true },
	} satisfies Record<NodeId, NodeSpec>,
	edges: [
		{ from: "intake", to: "research", guard: exists("topic") },
		{ from: "intake", to: "done" }, // model decides the request is trivial
		{ from: "research", to: "draft" },
		{ from: "draft", to: "review" },
		{
			from: "review",
			to: "draft",
			guard: both(below("score", 7), below("loops", 3)),
			effect: (r) => {
				r.counters.loops = (r.counters.loops ?? 0) + 1;
			},
		},
		{ from: "review", to: "publish", guard: atLeast("score", 7) },
		{ from: "review", to: "escalate", guard: atLeast("loops", 3) },
		{ from: "publish", to: "done", guard: exists("approved") },
	] satisfies Edge[],
};

/** Merged at startup; defineGraph throws on config errors. */
export const graph: Graph = defineGraph(topology, loadPersonas());
