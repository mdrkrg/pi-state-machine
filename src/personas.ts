import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NodeId } from "./types.ts";
import type { PersonaPayload } from "./graph-def.ts";

/**
 * Load personas/*.md. Frontmatter supports only "id: x" and "tools: [a, b]"; no YAML.
 * Throws on malformed files: persona data errors are startup errors too.
 */
export function loadPersonas(dir = fileURLToPath(new URL("../personas", import.meta.url))): Record<NodeId, PersonaPayload> {
	const out: Record<NodeId, PersonaPayload> = {};
	for (const name of readdirSync(dir).sort()) {
		if (!name.endsWith(".md")) continue;
		const raw = readFileSync(join(dir, name), "utf8");
		const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
		if (!m) throw new Error(`persona "${name}" has no frontmatter`);
		const [, frontmatter, body] = m;
		const id = frontmatter.match(/^id:\s*(\S+)\s*$/m)?.[1];
		if (!id) throw new Error(`persona "${name}" has no id`);
		const toolsRaw = frontmatter.match(/^tools:\s*\[([^\]]*)\]\s*$/m)?.[1] ?? "";
		const tools = toolsRaw
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		out[id] = { tools, body: body.trim() };
	}
	return out;
}
