import type { Edge, Graph, Registers } from "./types.ts";

export function createRegisters(graph: Graph): Registers {
	return {
		node: graph.entry,
		facts: {},
		counters: {},
		history: [],
	};
}

export function resetRegisters(reg: Registers, graph: Graph): void {
	reg.node = graph.entry;
	reg.facts = {};
	reg.counters = {};
	reg.history = [];
}

/** Apply an already-validated transition. Mutates node / facts / counters / history. */
export function commitTransition(
	reg: Registers,
	edge: Edge,
	payload: Record<string, unknown> | undefined,
	reason: string,
): void {
	edge.effect?.(reg);
	if (payload) Object.assign(reg.facts, payload);
	reg.node = edge.to;
	reg.history.push({ from: edge.from, to: edge.to, reason, ts: Date.now() });
}
