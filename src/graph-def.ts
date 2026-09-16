import type { Edge, Graph, NodeId, NodeSpec, Persona } from "./types.ts";

export interface Topology {
	entry: NodeId;
	nodes: Record<NodeId, NodeSpec>;
	edges: Edge[];
}

export interface PersonaPayload {
	tools: string[];
	body: string;
}

export type PersonaData = Record<NodeId, PersonaPayload>;

/**
 * Merge topology with persona data and run startup checks.
 * Config errors are startup errors: throw before anything runs.
 */
export function defineGraph(topology: Topology, personas: PersonaData): Graph {
	const errors: string[] = [];

	if (!topology.nodes[topology.entry]) {
		errors.push(`entry "${topology.entry}" is not a declared node`);
	}
	for (const e of topology.edges) {
		if (!topology.nodes[e.from]) errors.push(`edge from "${e.from}" is not a declared node`);
		if (!topology.nodes[e.to]) errors.push(`edge to "${e.to}" is not a declared node`);
	}

	for (const id of Object.keys(topology.nodes)) {
		if (topology.nodes[id].terminal) continue;
		if (!topology.edges.some((e) => e.from === id)) {
			errors.push(`node "${id}" has no outgoing edge`);
		}
	}

	if (!topology.edges.some((e) => e.to === "done")) {
		errors.push(`no edge leads to "done"`);
	}

	// Terminal nodes have no persona file; their persona is never injected
	// because the run terminates before the next LLM call.
	for (const id of Object.keys(topology.nodes)) {
		if (topology.nodes[id].terminal) continue;
		if (!personas[id]) errors.push(`node "${id}" has no persona file`);
	}

	if (errors.length > 0) {
		throw new Error(`invalid graph:\n- ${errors.join("\n- ")}`);
	}

	const nodes: Record<NodeId, Persona> = {};
	for (const id of Object.keys(topology.nodes)) {
		const spec = topology.nodes[id];
		const persona = personas[id];
		nodes[id] = {
			id,
			tools: persona?.tools ?? [],
			body: persona?.body ?? "",
			...(spec.terminal ? { terminal: true as const } : {}),
		};
	}

	return { entry: topology.entry, nodes, edges: topology.edges };
}
