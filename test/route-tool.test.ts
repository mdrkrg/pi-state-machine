import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { activeToolsFor, createRouteTool } from "../src/route-tool.ts";
import { createRegisters } from "../src/state.ts";
import { graph } from "../src/graph.ts";
import { createStubPi, stubContext } from "./helpers.ts";

function setup() {
	const stub = createStubPi();
	const state = createRegisters(graph);
	const tool = createRouteTool(stub.pi, graph, () => state);
	return { ...stub, state, tool };
}

const ctx = stubContext({ hasUI: false });

test("route rejects undeclared targets and lists the exits", async () => {
	const { tool } = setup();
	await assert.rejects(
		tool.execute("1", { target: "ghost", reason: "r" }, undefined, undefined, ctx),
		/illegal transition intake -> ghost; declared exits: research, done/,
	);
});

test("route surfaces guard rejections to the model", async () => {
	const { tool } = setup();
	await assert.rejects(
		tool.execute("1", { target: "research", reason: "r" }, undefined, undefined, ctx),
		/guard rejected intake -> research: missing topic/,
	);
});

test("route commits a valid non-terminal transition", async () => {
	const { tool, state, activeTools, entries } = setup();
	const result = await tool.execute("1", { target: "research", reason: "work", payload: { topic: "t" } }, undefined, undefined, ctx);

	assert.equal(state.node, "research");
	assert.equal(state.facts.topic, "t");
	assert.deepEqual(activeTools, [["route", "read_workspace"]]);
	assert.equal(entries.length, 1);
	assert.equal(entries[0].type, "orch.transition");
	const entry = entries[0].data as { from: string; to: string; reason: string; facts: Record<string, unknown> };
	assert.deepEqual({ from: entry.from, to: entry.to }, { from: "intake", to: "research" });
	assert.equal(entry.reason, "work");
	assert.deepEqual(entry.facts, { topic: "t" });
	assert.match((result.content[0] as { text: string }).text, /intake -> research/);
	assert.equal("terminate" in result && result.terminate, false);
});

test("route terminates on terminal nodes", async () => {
	const { tool, state } = setup();
	const result = await tool.execute("1", { target: "done", reason: "trivial" }, undefined, undefined, ctx);
	assert.equal(result.terminate, true);
	assert.equal(state.node, "done");
});

test("guards see the payload without mutating state on rejection", async () => {
	const { tool, state } = setup();
	await assert.rejects(
		tool.execute("1", { target: "research", reason: "r", payload: {} }, undefined, undefined, ctx),
		/missing topic/,
	);
	assert.equal(state.node, "intake");
	assert.deepEqual(state.facts, {});

	const result = await tool.execute("2", { target: "research", reason: "r", payload: { topic: "t" } }, undefined, undefined, ctx);
	assert.ok(result);
	assert.equal(state.facts.topic, "t");
});

test("route rejections leave the audit trail untouched", async () => {
	const { tool, entries } = setup();
	await assert.rejects(tool.execute("1", { target: "draft", reason: "skip" }, undefined, undefined, ctx), /illegal/);
	assert.deepEqual(entries, []);
});

test("activeToolsFor keeps route always available", () => {
	assert.deepEqual(activeToolsFor(graph, "intake"), ["route"]);
	assert.deepEqual(activeToolsFor(graph, "research"), ["route", "read_workspace"]);
	assert.deepEqual(activeToolsFor(graph, "draft"), ["route", "write_workspace"]);
	assert.deepEqual(activeToolsFor(graph, "publish"), ["route", "publish_external"]);
	assert.deepEqual(activeToolsFor(graph, "done"), ["route"]);
});

test("execute ignores the extension context", async () => {
	const { tool } = setup();
	const emptyCtx = {} as unknown as ExtensionContext;
	const result = await tool.execute("1", { target: "done", reason: "r" }, undefined, undefined, emptyCtx);
	assert.equal(result.terminate, true);
});
