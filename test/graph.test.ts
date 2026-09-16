import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defineGraph } from "../src/graph-def.ts";
import { graph } from "../src/graph.ts";
import { atLeast, atLeastCount, below, belowCount, both, exists } from "../src/guards.ts";
import { commitTransition, createRegisters, resetRegisters } from "../src/state.ts";
import { loadPersonas } from "../src/personas.ts";
import type { Registers } from "../src/types.ts";

const reg = (facts: Record<string, unknown>, counters: Record<string, number> = {}): Registers => ({
	node: "x",
	facts,
	counters,
	history: [],
});

test("merged graph passes startup checks", () => {
	assert.equal(graph.entry, "intake");
	assert.equal(graph.nodes.done.terminal, true);
	assert.equal(graph.nodes.escalate.terminal, true);
	assert.deepEqual(graph.nodes.review.tools, ["read_workspace"]);
	assert.ok(graph.nodes.review.body.length > 0);
	assert.equal(graph.nodes.done.body, "");
});

test("defineGraph throws on config errors", () => {
	const personas = { a: { tools: [], body: "b" } };
	assert.throws(() => defineGraph({ ...base(), entry: "ghost" }, personas), /entry "ghost" is not a declared node/);
	assert.throws(
		() => defineGraph({ ...base(), edges: [{ from: "a", to: "ghost" }] }, personas),
		/edge to "ghost" is not a declared node/,
	);
	assert.throws(
		() => defineGraph({ ...base(), edges: [{ from: "ghost", to: "done" }] }, personas),
		/edge from "ghost" is not a declared node/,
	);
	assert.throws(
		() => defineGraph({ ...base(), nodes: { ...base().nodes, stray: { id: "stray" } } }, personas),
		/node "stray" has no outgoing edge/,
	);
	assert.throws(() => defineGraph({ ...base(), edges: [] }, personas), /no edge leads to "done"/);
	assert.throws(() => defineGraph(base(), {}), /node "a" has no persona file/);
});

function base() {
	return {
		entry: "a",
		nodes: { a: { id: "a" }, done: { id: "done", terminal: true } },
		edges: [{ from: "a", to: "done" }],
	};
}

test("fact guards", () => {
	assert.deepEqual(exists("k")(reg({ k: 1 })), { ok: true });
	assert.deepEqual(exists("k")(reg({})), { ok: false, reason: "missing k" });
	assert.deepEqual(atLeast("k", 3)(reg({ k: 3 })), { ok: true });
	assert.deepEqual(atLeast("k", 3)(reg({ k: "5" })), { ok: true });
	assert.deepEqual(atLeast("k", 3)(reg({})), { ok: false, reason: "k=undefined < 3" });
	assert.deepEqual(below("k", 3)(reg({ k: 2 })), { ok: true });
	assert.deepEqual(below("k", 3)(reg({ k: 3 })), { ok: false, reason: "k=3 >= 3" });
});

test("counter guards read counters, not facts", () => {
	assert.deepEqual(atLeastCount("loops", 3)(reg({}, { loops: 3 })), { ok: true });
	assert.deepEqual(atLeastCount("loops", 3)(reg({ loops: 9 })), {
		ok: false,
		reason: "counters.loops=0 < 3",
	});
	assert.deepEqual(belowCount("loops", 3)(reg({}, { loops: 2 })), { ok: true });
	assert.deepEqual(belowCount("loops", 3)(reg({}, { loops: 3 })), {
		ok: false,
		reason: "counters.loops=3 >= 3",
	});
});

test("both returns the first failing reason", () => {
	const guard = both(exists("a"), atLeast("b", 1));
	assert.deepEqual(guard(reg({})), { ok: false, reason: "missing a" });
	assert.deepEqual(guard(reg({ a: 1 })), { ok: false, reason: "b=undefined < 1" });
	assert.deepEqual(guard(reg({ a: 1, b: 1 })), { ok: true });
});

test("guards are pure: repeated calls agree and do not mutate reg", () => {
	const r = reg({ k: 2 }, { loops: 1 });
	const snapshot = JSON.stringify(r);
	const guard = both(exists("k"), below("k", 3), belowCount("loops", 3));
	const first = guard(r);
	assert.deepEqual(first, { ok: true });
	assert.deepEqual(guard(r), first);
	assert.equal(JSON.stringify(r), snapshot);
});

test("commitTransition applies effect, then payload, then moves node", () => {
	const edge = {
		from: "intake",
		to: "research",
		effect: (r: Registers) => {
			r.facts.fromEffect = 1;
		},
	};
	const r = createRegisters(graph);
	commitTransition(r, edge, { fromEffect: 2, topic: "t" }, "why");
	assert.equal(r.node, "research");
	assert.equal(r.facts.fromEffect, 2);
	assert.equal(r.facts.topic, "t");
	assert.equal(r.history.length, 1);
	assert.deepEqual(r.history[0].from, "intake");
	assert.deepEqual(r.history[0].to, "research");
	assert.equal(r.history[0].reason, "why");
	assert.equal(typeof r.history[0].ts, "number");
});

test("resetRegisters restores the entry state", () => {
	const r = createRegisters(graph);
	commitTransition(r, graph.edges[0], { topic: "t" }, "why");
	resetRegisters(r, graph);
	assert.equal(r.node, "intake");
	assert.deepEqual(r.facts, {});
	assert.deepEqual(r.counters, {});
	assert.deepEqual(r.history, []);
});

test("review loop caps out and escalates on the real graph", () => {
	const r = createRegisters(graph);
	const tryRoute = (from: string, to: string, payload: Record<string, unknown>): boolean => {
		const edge = graph.edges.find((e) => e.from === from && e.to === to);
		assert.ok(edge, `edge ${from} -> ${to} must exist`);
		const merged = { ...r, facts: { ...r.facts, ...payload } };
		const verdict = edge.guard?.(merged) ?? { ok: true as const };
		if (!verdict.ok) return false;
		commitTransition(r, edge, payload, "test");
		return true;
	};

	assert.ok(tryRoute("intake", "research", { topic: "t" }));
	assert.ok(tryRoute("research", "draft", { findings: "f" }));
	assert.ok(tryRoute("draft", "review", {}));
	for (const expected of [1, 2, 3]) {
		assert.ok(tryRoute("review", "draft", { score: 2 }), `reject ${expected} must pass`);
		assert.equal(r.counters.loops, expected);
		assert.ok(tryRoute("draft", "review", {}));
	}
	assert.equal(tryRoute("review", "draft", { score: 2 }), false);
	assert.equal(tryRoute("review", "publish", { score: 2 }), false);
	assert.ok(tryRoute("review", "escalate", {}));
	assert.equal(graph.nodes[r.node].terminal, true);
});

test("loadPersonas parses frontmatter and rejects malformed files", () => {
	const dir = mkdtempSync(join(tmpdir(), "personas-"));
	try {
		writeFileSync(join(dir, "ok.md"), "---\nid: x\ntools: [a, b]\n---\nbody here\n");
		writeFileSync(join(dir, "plain.md"), "no frontmatter");
		assert.throws(() => loadPersonas(dir), /no frontmatter/);

		rmSync(join(dir, "plain.md"));
		writeFileSync(join(dir, "noid.md"), "---\ntools: []\n---\nbody\n");
		assert.throws(() => loadPersonas(dir), /no id/);

		rmSync(join(dir, "noid.md"));
		const loaded = loadPersonas(dir);
		assert.deepEqual(loaded.x, { tools: ["a", "b"], body: "body here" });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
