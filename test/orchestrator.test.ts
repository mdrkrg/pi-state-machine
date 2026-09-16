import assert from "node:assert/strict";
import { test } from "node:test";
import type {
	ContextEvent,
	ExtensionCommandContext,
	SessionStartEvent,
	ToolCallEvent,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import orchestrate from "../extensions/orchestrator.ts";
import { createStubPi, stubContext } from "./helpers.ts";

interface ContextHookResult {
	messages?: Array<{ role: string; customType: string; content: Array<{ text: string }> }>;
}

function setup() {
	const stub = createStubPi();
	orchestrate(stub.pi);
	const routeTool = stub.tools.find((t) => (t as ToolDefinition).name === "route") as ToolDefinition;
	const contextHandler = stub.handlers.get("context") as (event: ContextEvent) => ContextHookResult;
	const startHandler = stub.handlers.get("session_start") as (event: SessionStartEvent) => void;
	const gate = stub.handlers.get("tool_call") as (event: ToolCallEvent, ctx: unknown) => Promise<unknown>;
	return { ...stub, routeTool, contextHandler, startHandler, gate };
}

const run = (
	tool: ToolDefinition,
	target: string,
	payload?: Record<string, unknown>,
): Promise<unknown> =>
	tool.execute(
		"1",
		payload ? { target, reason: "test", payload } : { target, reason: "test" },
		undefined,
		undefined,
		stubContext({ hasUI: false }),
	);

test("registers route, mocks and the orch:state command", () => {
	const stub = createStubPi();
	orchestrate(stub.pi);
	const names = stub.tools.map((t) => (t as ToolDefinition).name).sort();
	assert.deepEqual(names, ["publish_external", "read_workspace", "route", "write_workspace"]);
	assert.ok(stub.commands.some((c) => c.name === "orch:state"));
	assert.ok(stub.handlers.has("session_start"));
	assert.ok(stub.handlers.has("context"));
	assert.ok(stub.handlers.has("tool_call"));
});

test("orch:state prints the current state", async () => {
	const stub = createStubPi();
	orchestrate(stub.pi);
	const command = stub.commands.find((c) => c.name === "orch:state");
	assert.ok(command);
	const notified: string[] = [];
	const ctx = {
		ui: {
			notify: (message: string) => {
				notified.push(message);
			},
		},
	} as unknown as ExtensionCommandContext;
	await command.handler("", ctx);
	assert.equal(notified.length, 1);
	assert.match(notified[0], /"node": "intake"/);
	assert.match(notified[0], /"history": \[\]/);
});

test("publish_external mock publishes", async () => {
	const stub = createStubPi();
	orchestrate(stub.pi);
	const tool = stub.tools.find((t) => (t as ToolDefinition).name === "publish_external") as ToolDefinition;
	const result = await tool.execute("1", { content: "c" }, undefined, undefined, stubContext({ hasUI: false }));
	assert.equal((result.content[0] as { text: string }).text, "published");
});

test("session_start installs the entry tool set", () => {
	const { startHandler, activeTools } = setup();
	startHandler({ type: "session_start", reason: "startup" });
	assert.deepEqual(activeTools, [["route"]]);
});

test("session_start resets a spent state back to intake", async () => {
	const { startHandler, routeTool, contextHandler } = setup();
	await run(routeTool, "done");
	await assert.rejects(run(routeTool, "research", { topic: "t" }), /illegal transition done/);
	startHandler({ type: "session_start", reason: "startup" });
	await run(routeTool, "research", { topic: "t" });
	const second = contextHandler({ messages: [], type: "context" });
	assert.match(second.messages?.[0]?.content[0].text ?? "", /\[current node: research\]/);
});

test("context hook appends the current node persona at the tail", () => {
	const { contextHandler } = setup();
	const first = contextHandler({ messages: [], type: "context" });
	assert.equal(first.messages?.length, 1);
	const message = first.messages?.[0];
	assert.equal(message?.role, "custom");
	assert.equal(message?.customType, "orch.persona");
	assert.match(message?.content[0].text ?? "", /\[current node: intake\]/);
	assert.match(message?.content[0].text ?? "", /route is your only tool/);
});

test("context hook follows node switches", async () => {
	const { contextHandler, routeTool } = setup();
	await run(routeTool, "research", { topic: "t" });
	const second = contextHandler({ messages: [], type: "context" });
	assert.match(second.messages?.[0]?.content[0].text ?? "", /\[current node: research\]/);
	assert.match(second.messages?.[0]?.content[0].text ?? "", /read_workspace/);
});

test("gate passes non-publish tools through", async () => {
	const { gate } = setup();
	const event = { type: "tool_call", toolCallId: "1", toolName: "read_workspace", input: {} } as ToolCallEvent;
	assert.equal(await gate(event, stubContext({ hasUI: false })), undefined);
});

test("gate blocks world writes without UI", async () => {
	const { gate } = setup();
	const event = { type: "tool_call", toolCallId: "1", toolName: "publish_external", input: {} } as ToolCallEvent;
	const result = (await gate(event, stubContext({ hasUI: false }))) as { block: boolean; reason: string };
	assert.equal(result.block, true);
	assert.match(result.reason, /no UI environment/);
});

test("gate records approval and unblocks publish -> done", async () => {
	const { gate, routeTool } = setup();
	await run(routeTool, "research", { topic: "t" });
	await run(routeTool, "draft");
	await run(routeTool, "review");
	await run(routeTool, "publish", { score: 7 });

	const event = { type: "tool_call", toolCallId: "1", toolName: "publish_external", input: {} } as ToolCallEvent;
	assert.equal(await gate(event, stubContext({ hasUI: true, confirm: async () => true })), undefined);

	const result = await run(routeTool, "done");
	assert.ok(result);
});

test("gate blocks declined publications and the guard holds", async () => {
	const { gate, routeTool } = setup();
	await run(routeTool, "research", { topic: "t" });
	await run(routeTool, "draft");
	await run(routeTool, "review");
	await run(routeTool, "publish", { score: 7 });

	const event = { type: "tool_call", toolCallId: "1", toolName: "publish_external", input: {} } as ToolCallEvent;
	const result = (await gate(event, stubContext({ hasUI: true, confirm: async () => false }))) as {
		block: boolean;
		reason: string;
	};
	assert.equal(result.block, true);
	assert.match(result.reason, /declined/);
	await assert.rejects(run(routeTool, "done"), /missing approved/);
});

