---
name: pi-state-machine-dev
description: Develop and verify the pi-state-machine PoC. Use when changing the route tool, hooks, graph topology, guards, personas, or state, and when running the unit tests, type check, or the live orchestration sandbox in live/.
---

# pi-state-machine development

In-loop route-tool orchestration PoC. One user prompt equals one Pi agent run;
node transitions happen inside that run via `setActiveTools` + `on("context")`.

## Commands

```sh
pnpm check                          # tsc --noEmit
node --test test/*.test.ts          # all layers, faux provider, no network
```

Run from the repo root. Tests never call a real provider.

## Live testing

Run `pi` in `live/`, not at the repo root. Root `.pi/` intentionally has no
`settings.json`, so the extension does not load while developing this repo.

```sh
cd live && pi -nc      # -nc avoids inheriting the repo AGENTS.md
```

See `live/README.md`.

## Invariants to preserve

- `src/graph.ts`, `src/guards.ts`, `src/types.ts`, `src/state.ts` must not
  import any `@earendil-works/*` package. Host coupling stays in
  `extensions/orchestrator.ts`, `src/route-tool.ts`, `src/mocks.ts`.
- Guards are pure functions of `Registers`; effects mutate `reg`; transitions
  commit in order effect -> payload -> node -> history.
- Topology errors are startup errors: `defineGraph` throws.
- `route` never terminates except at terminal nodes; persona switching rides
  `on("context")` (request-local, no transcript writes).

## Extension wiring facts (verified against pi 0.85.1)

- Project resources resolve strictly from `cwd/.pi` (no ancestor walk):
  `package-manager.js` `projectBaseDir = join(cwd, CONFIG_DIR_NAME)`.
- `settings.json` `extensions` paths resolve relative to `.pi`, hence
  `"../../extensions"` from `live/.pi`.
- The root `package.json` `"pi"` manifest is not scanned at cwd level; it only
  applies when the repo is consumed as an installed package.
- `AGENTS.md` does walk ancestors, so live runs need `-nc` for isolation.

## Layout

```
extensions/orchestrator.ts   assembly layer: pi API <-> src
src/                         pure core (graph, guards, state, types)
src/route-tool.ts, mocks.ts  host-touching tool definitions
personas/*.md                persona body + tools whitelist frontmatter
test/                        node:test, faux provider / stubs
live/                        live sandbox with its own .pi/settings.json
```
