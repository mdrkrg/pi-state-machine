# Pi harness facts (verified against pi 0.85.1)

Verified against the pi version this repo pins (`@earendil-works/pi-coding-agent`
/ `@earendil-works/pi-ai` `0.85.1`). Facts are stated through public API
names/signatures; upstream line numbers drift, so match symbols, not positions.

## Pi's own guidance for extending pi

Pi ships its authoring docs and runnable examples inside the installed package.
Read these first; do not reverse-engineer the runtime when a doc exists.

- `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md` -- extension
  API: hooks, tools, commands, and the `ctx` surface.
- `.../docs/skills.md`, `.../docs/settings.md`, `.../docs/packages.md`,
  `.../docs/sessions.md`, `.../docs/sdk.md` -- skills, resource discovery and
  settings, package manifests, session/entry format, SDK host.
- `.../examples/extensions/` -- runnable extensions; `confirm-destructive.ts` is
  the reference for a `ctx.ui.confirm` + `sessionManager.getEntries()` gate.
- The pi repository itself (`https://github.com/earendil-works/pi`) keeps its own
  flat dev skills under `.pi/skills/` for developing pi. They are not part of the
  published package, so fetch them from upstream if needed. This repo's
  `pi-state-machine-dev` skill is the one for this PoC.

## Facts the design depends on

- `AgentToolResult.terminate` ends a tool batch early **only when every finalized
  result in the batch sets it** (`shouldTerminateToolBatch` enforces the "every"
  rule). Without it, the loop takes another turn; after a batch the loop checks
  the follow-up queue and ends the run when nothing is queued.
- `ExtensionAPI.setActiveTools(toolNames: string[])` takes effect on the **next**
  agent turn, because the tool list is re-snapshotted from agent state at the start
  of each turn (`AgentSession`'s next-turn refresh).
- `ExtensionAPI.on("context", handler)` runs before every LLM call. Its returned
  messages are request-local: the agent loop applies them through
  `config.transformContext` over a copy, so they never reach the transcript.
- `on("context")` is available in interactive mode: interactive mode builds the
  agent through `createAgentSession`, which wires `transformContext` to the
  extension runner's context emission.
- Custom messages (`role: "custom"`, produced by `createCustomMessage(customType,
  content, ...)`) are converted to `role: "user"` for the model (`convertToLlm`).
  That is what lets a persona body act as instructions.
- `ExtensionAPI.on("before_agent_start", handler)` fires **once per user prompt**,
  not per turn. A returned `systemPrompt` replaces the whole system prompt for the
  run (`AgentSession._systemPromptOverride`) and is reset when the run finishes, so
  it cannot carry a mid-run persona switch.
- Extensions cannot change the system prompt mid-run: `_systemPromptOverride` has
  no extension-facing setter, and `setActiveTools` only rebuilds the base prompt.
- `ExtensionContext.sessionManager.appendEntry(customType, data)` is the only
  persistence directly usable by extensions. It writes a `CustomEntry`, which does
  **not** enter LLM context; `getEntries()` reads entries back (the recovery path).
- `ExtensionContext.hasUI` plus `ctx.ui.confirm(title, message)` implement the
  approval gate. `hasUI` is false in a headless context, so deny by default there.
- `ToolDefinition.execute(toolCallId, params, signal, onUpdate, ctx)`: the fifth
  parameter is the `ExtensionContext`, so tools get `ui` and `sessionManager`.
- An error thrown inside `execute` becomes an `isError: true` tool result carrying
  the thrown message (`createErrorToolResult`). `AgentToolResult` has no `isError`
  field of its own, so throwing is the only way for a tool to flag failure.
- `ExtensionAPI.on("tool_call", handler)` may return `{ block: true, reason }`.
  `event.input` is mutable in place, and later handlers see earlier mutations with
  no re-validation.
- Tools are defined with `defineTool(...)` and registered with
  `ExtensionAPI.registerTool(...)`; extensions are TypeScript loaded by jiti, so
  there is no build step.

## Mechanisms deliberately not used

- **`values` registers** (`value()` / `setValue` / `appendList`): wired only in
  pi's experimental sources, not exported from the stable extension surface. Use an
  in-memory register plus `appendEntry` for audit instead.
- **`before_agent_start` for persona injection**: it fires once per user prompt, so
  a mid-run node switch cannot use it. Use `on("context")`.
- **Cross-run / cross-session orchestration**: transitions finish inside one run,
  so no continuation pipeline is needed.

## Extension discovery and wiring

- `PackageManager` resolves project resources from
  `projectBaseDir = join(cwd, configDirName)` with `configDirName` = `.pi`, and no
  ancestor walk.
- `settings.json` `extensions` entries resolve relative to that `.pi` base, which
  is why the sandbox uses `"../../extensions"`.
- Project resources load only when `settingsManager.isProjectTrusted()`; the first
  interactive run prompts for trust.
- The root `package.json` `pi` manifest is **not** scanned at cwd level; it applies
  when the repo is consumed as an installed package.
- `AGENTS.md` does walk ancestors, so live runs use `-nc` for isolation.

See `docs/settings.md` and `docs/packages.md` for the discovery rules.
