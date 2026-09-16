import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface StubPi {
	pi: ExtensionAPI;
	handlers: Map<string, unknown>;
	activeTools: string[][];
	entries: Array<{ type: string; data: unknown }>;
	tools: unknown[];
	commands: Array<{ name: string; handler: (args: string, ctx: unknown) => Promise<void> }>;
}

/** Records setActiveTools / appendEntry / on / registerTool / registerCommand; safe to hand to code under test. */
export function createStubPi(): StubPi {
	const handlers = new Map<string, unknown>();
	const activeTools: string[][] = [];
	const entries: Array<{ type: string; data: unknown }> = [];
	const tools: unknown[] = [];
	const commands: Array<{ name: string; handler: (args: string, ctx: unknown) => Promise<void> }> = [];
	const pi = {
		on: (event: string, handler: unknown) => {
			handlers.set(event, handler);
		},
		setActiveTools: (names: string[]) => {
			activeTools.push([...names]);
		},
		appendEntry: (type: string, data?: unknown) => {
			entries.push({ type, data });
		},
		registerTool: (tool: unknown) => {
			tools.push(tool);
		},
		registerCommand: (name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
			commands.push({ name, handler: options.handler });
		},
	};
	return { pi: pi as unknown as ExtensionAPI, handlers, activeTools, entries, tools, commands };
}

export function stubContext(options: { hasUI: boolean; confirm?: () => Promise<boolean> }): ExtensionContext {
	return {
		hasUI: options.hasUI,
		ui: { confirm: options.confirm ?? (async () => false) },
	} as unknown as ExtensionContext;
}
