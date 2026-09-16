import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	fauxAssistantMessage,
	fauxText,
	fauxToolCall,
	registerFauxProvider,
} from "@earendil-works/pi-ai/compat";
import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import { createAgentSession, SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const say = (text: string) => fauxAssistantMessage(text);
const call = (name: string, args: Record<string, unknown>) =>
	fauxAssistantMessage([fauxText(name), fauxToolCall(name, args)], { stopReason: "toolUse" });
const route = (target: string, reason: string, payload?: Record<string, unknown>) =>
	call("route", payload ? { target, reason, payload } : { target, reason });

interface FauxSession {
	session: Awaited<ReturnType<typeof createAgentSession>>["session"];
	contexts: Context[];
}

/**
 * Real AgentSession with our extension discovered the production way
 * (.pi/settings.json); the model is the scripted faux provider, so the
 * whole loop runs without any network or API call.
 */
async function createFauxSession(steps: AssistantMessage[], t: test.TestContext): Promise<FauxSession> {
	const faux = registerFauxProvider();
	const contexts: Context[] = [];
	faux.setResponses(
		steps.map((message) => (context: Context) => {
			contexts.push(context);
			return message;
		}),
	);
	const agentDir = mkdtempSync(join(tmpdir(), "orch-e2e-"));
	writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ faux: { type: "api_key", key: "faux-key" } }));
	writeFileSync(
		join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				faux: { baseUrl: "http://faux.local", api: "faux", apiKey: "faux-key", models: [{ id: "faux-1", name: "Faux" }] },
			},
		}),
	);
	const { session } = await createAgentSession({
		cwd: repoRoot,
		agentDir,
		model: faux.getModel(),
		sessionManager: SessionManager.inMemory(),
		noTools: "builtin",
	});
	t.after(() => {
		faux.unregister();
		rmSync(agentDir, { recursive: true, force: true });
	});
	return { session, contexts };
}

function entries(session: FauxSession["session"]): SessionEntry[] {
	return session.sessionManager.getEntries();
}

function transitions(session: FauxSession["session"]): Array<[string, string]> {
	return entries(session)
		.filter((e) => e.type === "custom" && (e as { customType?: string }).customType === "orch.transition")
		.map((e) => {
			const data = (e as { data: { from: string; to: string } }).data;
			return [data.from, data.to] as [string, string];
		});
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => (part && typeof part === "object" && part.type === "text" ? String(part.text) : ""))
			.join("\n");
	}
	return "";
}

function toolResults(session: FauxSession["session"]): Array<{ name: string; isError: boolean; text: string }> {
	return entries(session)
		.filter((e) => e.type === "message")
		.map((e) => (e as { message: { role: string; toolName?: string; isError?: boolean; content?: unknown } }).message)
		.filter((m) => m.role === "toolResult")
		.map((m) => ({ name: m.toolName ?? "", isError: m.isError === true, text: textOf(m.content) }));
}

function persona(contexts: Context[], call: number): string | undefined {
	const messages = contexts[call]?.messages ?? [];
	for (let i = messages.length - 1; i >= 0; i--) {
		const match = textOf(messages[i].content).match(/\[current node: (\w+)\]/);
		if (match) return match[1];
	}
	return undefined;
}

test("fixed script routes intake to done and ends the run", async (t) => {
	const fs = await createFauxSession([route("done", "trivial")], t);
	await fs.session.prompt("hello");
	assert.deepEqual(transitions(fs.session), [["intake", "done"]]);
	assert.equal(fs.contexts.length, 1);
	assert.equal(persona(fs.contexts, 0), "intake");
	assert.equal(toolResults(fs.session).some((r) => r.isError), false);
});

test("illegal transition becomes a model-visible error result", async (t) => {
	const fs = await createFauxSession([route("research", "wants work"), route("done", "give up")], t);
	await fs.session.prompt("hello");
	const results = toolResults(fs.session).filter((r) => r.name === "route");
	assert.equal(results.length, 2);
	assert.equal(results[0].isError, true);
	assert.match(results[0].text, /missing topic/);
	assert.equal(results[1].isError, false);
	assert.deepEqual(transitions(fs.session), [["intake", "done"]]);
	assert.ok(fs.contexts.length >= 2);
});

test("one prompt walks several nodes with persona and toolset swaps", async (t) => {
	const fs = await createFauxSession(
		[
			route("research", "work", { topic: "t" }),
			call("read_workspace", {}),
			route("draft", "write", { findings: "f" }),
			call("write_workspace", { content: "doc" }),
			route("review", "hand over"),
			say("handed over"),
		],
		t,
	);
	await fs.session.prompt("run the pipeline");
	assert.deepEqual(transitions(fs.session), [
		["intake", "research"],
		["research", "draft"],
		["draft", "review"],
	]);
	assert.deepEqual(fs.contexts.map((_, i) => persona(fs.contexts, i)), [
		"intake",
		"research",
		"research",
		"draft",
		"draft",
		"review",
	]);
	// read_workspace / write_workspace executed: only possible if the active
	// tool set actually followed the persona whitelist across turns.
	assert.equal(toolResults(fs.session).some((r) => r.isError), false);
});

test("without UI the gate blocks publish and the guard holds done", async (t) => {
	const fs = await createFauxSession(
		[
			route("research", "work", { topic: "t" }),
			route("draft", "write"),
			route("review", "hand over"),
			route("publish", "looks good", { score: 8 }),
			call("publish_external", { content: "c" }),
			route("done", "try to finish"),
			say("stopped"),
		],
		t,
	);
	await fs.session.prompt("run the pipeline");
	const publish = toolResults(fs.session).find((r) => r.name === "publish_external");
	assert.ok(publish);
	assert.equal(publish.isError, true);
	assert.match(publish.text, /no UI environment|declined/);
	const finish = toolResults(fs.session).filter((r) => r.name === "route").at(-1);
	assert.ok(finish);
	assert.equal(finish.isError, true);
	assert.match(finish.text, /missing approved/);
	assert.deepEqual(transitions(fs.session), [
		["intake", "research"],
		["research", "draft"],
		["draft", "review"],
		["review", "publish"],
	]);
});
