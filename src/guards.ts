import type { Guard } from "./types.ts";

export const exists = (k: string): Guard => (r) =>
	r.facts[k] !== undefined ? { ok: true } : { ok: false, reason: `missing ${k}` };

export const atLeast = (k: string, n: number): Guard => (r) =>
	Number(r.facts[k] ?? 0) >= n ? { ok: true } : { ok: false, reason: `${k}=${r.facts[k]} < ${n}` };

export const below = (k: string, n: number): Guard => (r) =>
	Number(r.facts[k] ?? 0) < n ? { ok: true } : { ok: false, reason: `${k}=${r.facts[k]} >= ${n}` };

export const both = (...gs: Guard[]): Guard => (r) => {
	for (const g of gs) {
		const v = g(r);
		if (!v.ok) return v;
	}
	return { ok: true };
};
