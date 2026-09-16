export type NodeId = string;

/** Guard is a pure function of reg; must not mutate it. */
export type Guard = (reg: Registers) => { ok: true } | { ok: false; reason: string };

export interface Edge {
	from: NodeId;
	to: NodeId;
	/** Absent means unconditional pass. */
	guard?: Guard;
	/** Side effects after a successful transition. May mutate reg. */
	effect?: (reg: Registers) => void;
}

export interface Persona {
	id: NodeId;
	/** Domain tools allowed at this node (route is always available). From persona frontmatter. */
	tools: string[];
	/** Body injected before each LLM call. */
	body: string;
	/** Terminal node: entering it terminates the run. From topology. */
	terminal?: boolean;
}

/** Node declared in topology; tools/body are merged from persona files at startup. */
export interface NodeSpec {
	id: NodeId;
	terminal?: boolean;
}

/** Merged topology + persona data; the single runtime authority. */
export interface Graph {
	entry: NodeId;
	nodes: Record<NodeId, Persona>;
	edges: Edge[];
}

/** The only orchestration runtime state. Lifetime = one session. */
export interface Registers {
	node: NodeId;
	/** Node-reported data (topic / findings / score / approved ...). */
	facts: Record<string, unknown>;
	/** Loop protection counters. */
	counters: Record<string, number>;
	/** Audit: in-memory transition history of the current run. */
	history: Array<{ from: NodeId; to: NodeId; reason: string; ts: number }>;
}
