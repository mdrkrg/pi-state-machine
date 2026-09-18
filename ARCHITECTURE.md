# pi-state-machine: in-loop route-tool orchestration

**The proposition this PoC must prove.** One ordinary tool (`route`) plus three
extension hooks (`session_start`, `context`, `tool_call`) are enough to run all of
the orchestration -- topology routing, persona switching, tool-policy switching,
deterministic guards, human-in-the-loop approval -- **inside a single Pi agent
run**, without forking the runtime, opening sub-sessions, or depending on an
external orchestration framework.

**Scope.** Only the in-loop route-tool direction. The orchestration layer is
self-contained and uses only Pi's public extension API.
**Host.** The extension form of interactive `pi`. This PoC does not build a
headless host, a CLI, or an SDK host driver.

## Runtime model: one user prompt is one run

A user prompt starts one agent run. Every node transition happens inside that run
as consecutive turns. A transition never starts a new run or session.

```
user prompt
   |
   v
[run start] session_start resets registers; the entry persona is ready
   |
   v
+----------------------------- turn N ------------------------------+
| on("context") appends the current node persona to the request      |
| model calls the node domain tools (per persona whitelist)          |
| model calls route(target, reason, payload)                         |
|   validate edge -> run guard -> commit registers                   |
|   setActiveTools(target) -> append audit entry                     |
|   return a normal tool result (no terminate)                       |
+-------------------------------------------------------------------+
   |  the next turn is prepared with the new tool set
   v  repeat until route reaches a terminal node
route reaches done / escalate
   -> returns terminate; the run ends and control returns to the user
```

Three consequences follow directly:

1. **Persona injection rides `context`.** The hook fires before every LLM call
   and its return value is request-local, so the persona is never written to the
   transcript and needs no dedup logic. The entry node and later nodes share this
   single injection path.
2. **Tool policy rides `setActiveTools`.** Tools are re-snapshotted at the start of
   every turn, so a mid-run call applies to the next turn.
3. **Transitions are free.** No session startup, no context rebuild, no run
   boundary. This is the entire reason the design exists.

## The harness seams this design stands on

- A tool result without `terminate` lets the loop take another turn; a batch ends
  early only when every call in it asks to terminate.
- The tool list is re-snapshotted at every turn start, so `setActiveTools` called
  mid-run takes effect on the next turn.
- `context` runs before every LLM call and its return value is used for that
  request only.
- A tool that throws becomes an error tool result carrying the message, which the
  model can read and react to.
- `tool_call` can block a call with a reason, and `appendEntry` persists extension
  state as a custom entry that never enters the LLM context.

These were verified against pi 0.85.1, the version this repo pins. The facts,
the mechanisms this design deliberately avoids, and pointers to pi's own
extension docs and examples are in the `pi-state-machine-dev` skill,
`references/pi-harness-facts.md`.

## The design

### Topology is code, personas are data

The topology (nodes, edges, guards, effects) is declared in code. A persona is a
Markdown file. At startup they are merged into one graph object -- the single
runtime authority.

Startup validates the graph and throws on the first problem: a topology error is a
startup error, not a runtime surprise.

1. the entry is a declared node, and every edge endpoint is declared;
2. every non-terminal node has at least one out-edge;
3. at least one edge leads to `done`;
4. every non-terminal node has a persona file.

Malformed persona files throw as well. Terminal nodes need no persona: the run
ends before the next LLM call, so their persona would never be injected.

### Nodes are personas

A persona file carries:

- **id** -- must match the node id in the topology;
- **tools** -- the domain-tool whitelist for this node (`route` is always
  available and is not listed);
- **body** -- the text injected into the prompt, that is, the node's identity and
  instructions.

Frontmatter supports only `id` and a bracketed `tools` list; it is parsed without
a YAML dependency. Everything after the frontmatter is the body.

### Registers: the only runtime state

One register object is the whole orchestration state. Its lifetime is one session;
`session_start` resets it.

| Field | Meaning |
| --- | --- |
| `node` | the current node id; starts at the topology entry |
| `facts` | data reported by nodes (topic, findings, score, approved, ...) |
| `counters` | loop-protection counters (loop iterations, ...) |
| `history` | in-memory transition log for the current run; the durable copy is the audit entry |

### Edges: a pure guard plus an effect

An edge goes from one node to another with two optional fields:

- a **guard**, a pure function of the registers that returns pass or
  reject-with-reason. An absent guard means an unconditional pass.
- an **effect**, run only after a successful transition; it may mutate the
  registers, typically to bump a counter.

Guards never mutate the registers. Fact-based guards read `facts`; loop-cap guards
read `counters` -- keeping the two apart is what makes the cap correct.

The split the design wants to stress: **the model produces data**
(`facts.score`), and **pure code makes the decision** to jump.

### The `route` tool

`route` is the only orchestration tool and is always active. Its parameters:

| Name | Required | Meaning |
| --- | --- | --- |
| `target` | yes | target node id; must be one of the current node's declared exits |
| `reason` | yes | one-sentence justification; goes to the audit entry |
| `payload` | no | keys merged into `facts` on a successful transition |

Execution order:

1. find the declared `from -> target` edge; if none, throw listing the declared
   exits;
2. evaluate the guard against the registers **with the payload merged onto a
   copy**, so a payload-gated edge validates in a single call and a rejection
   mutates nothing; if the guard rejects, throw with its reason;
3. commit in this order: effect, then payload merge, then set `node`, then append
   to `history`;
4. install the target's active tool set;
5. append the audit entry with from, to, reason, and the resulting facts;
6. return a normal tool result -- with `terminate` only if the target is terminal.

Both throw cases become an error tool result via the harness, so the model sees
the reason and can reroute on its own. Throwing is the only option: the tool
result type has no error flag of its own.

The tool set for a node is `route` plus the persona whitelist. Because the loop
ends a tool batch only when **every** call in it asks to terminate, `route` is
used as a single call.

### Hooks: the assembly layer

The extension registers exactly three hooks and one debug command.

- **`session_start`** -- reset the registers and install the entry node's tool
  set.
- **`context`** -- append the current node's persona as a `custom` message at the
  tail of the request messages. Custom messages reach the model as user messages,
  which is what makes them usable as instructions. The transform is request-local,
  so there is no transcript write and no dedup; each LLM call simply sees the
  current node.
- **`tool_call`** -- the human-in-the-loop gate on world writes. No UI means deny.
  A declined confirmation blocks the call with a reason. An approval writes
  `facts.approved`, which the `publish -> done` guard consumes: **approval is
  state, not atmosphere.**
- **`orch:state`** -- a command that prints the registers, for debugging.

### Worked example: the PoC topology

Nodes:

| Node | Persona tools | Terminal |
| --- | --- | --- |
| intake | none | no |
| research | read_workspace | no |
| draft | write_workspace | no |
| review | read_workspace | no |
| publish | publish_external | no |
| done | none | yes |
| escalate | none | yes |

Edges:

| From | To | Guard | Effect |
| --- | --- | --- | --- |
| intake | research | topic exists | |
| intake | done | none (the model decides the request is trivial) | |
| research | draft | none | |
| draft | review | none | |
| review | draft | score < 7 and loops < 3 | loops += 1 |
| review | publish | score >= 7 | |
| review | escalate | loops >= 3 | |
| publish | done | approved exists | |

The three domain tools are mocks over a session-lifetime in-memory workspace:
`read_workspace`, `write_workspace`, and `publish_external` (the world write that
goes through the approval gate).

## Failure policy

Principle: **throw in exactly one place** -- an illegal transition or a guard
rejection -- because the tool result type has no error flag; everything else
passes through without a branch.

| Situation | Handling |
| --- | --- |
| model routes to an undeclared edge | throw; the error result lists the declared exits |
| guard rejects | throw; the guard reason goes to the model, which reroutes |
| model ends its reply without calling `route` | not handled: the run simply ends and orchestration stops at the current node (a known gap, not a bug) |
| `publish_external` not confirmed | `tool_call` blocks it; the model receives a blocked result and may reroute or retry |
| topology misconfiguration (bad entry, dangling edge) | throw at startup |

Explicitly unhandled:

- concurrent `route` calls, or several in one batch;
- payload schema validation (payload keys are merged as-is);
- truncated tool calls, provider retries, and compaction interacting with routing;
- races between `setActiveTools` and in-flight tool calls in the same node.

The only impact of the known gap is that an occasional missing `route` stalls the
flow. The PoC fallback is the user saying "continue". **Do not add machinery for
it.**

## Recovery (optional)

The happy path keeps state in memory and writes each transition to an audit entry.
To resume: on `session_start`, if the reason is `resume`, scan the custom entries,
rebuild `node` and `facts`, and restore the tool set for that node. This is the
recovery pattern Pi documents: scan custom entries to rebuild internal state.

Recovery is **not atomic**: the transition and the audit entry are separate
commits, so a crash between them loses one transition. Accepted for the PoC and
noted in the code.

## Wiring and developer workflow

```
pi-state-machine/
├── ARCHITECTURE.md
├── package.json                 # "pi" manifest: ./extensions/orchestrator.ts
├── .pi/skills/                  # development skills only; no settings.json here
├── live/                        # live sandbox: pi started here loads the extension
│   ├── .pi/settings.json        # { "extensions": ["../../extensions"] }
│   └── README.md
├── extensions/orchestrator.ts   # assembly: pi API <-> src
├── src/                         # pure core plus host-touching tool definitions
├── personas/*.md
└── test/                        # node:test, faux provider / stubs
```

Discovery facts that differ from intuition:

- A `pi` section in the root `package.json` is **not** scanned at the cwd level.
  It applies only when the repo is installed as a package.
- At the project level, Pi auto-discovers `cwd/.pi/extensions` and resolves the
  `extensions` paths from `settings.json` relative to `.pi` itself -- hence
  `"../../extensions"` in the sandbox.
- Project resources are not discovered by walking parent directories, and they
  load only when the project is trusted (the first interactive run asks).
- `AGENTS.md`, by contrast, does walk ancestors, which is why the live run uses
  `-nc` for isolation.

Start the live sandbox with `cd live && pi -nc`; see `live/README.md`.

Dependency discipline: `src/graph.ts`, `src/guards.ts`, `src/types.ts`, and
`src/state.ts` import no Pi package -- pure data and pure functions. Only
`extensions/orchestrator.ts`, `src/route-tool.ts`, and `src/mocks.ts` touch the
host. Swapping hosts after the proof means rewriting the assembly file only.

## Implementation milestones

Each step is independently verifiable. Do not skip ahead or write tests early.

1. **Load.** Wire the extension; it only logs that it loaded. Accept: `pi` starts
   without errors and the log appears.
2. **One tool.** Register an `echo` tool and set the active tools on
   `session_start`. Accept: the model can call it.
3. **Static layer.** Types, the graph merger with its startup checks, guards, the
   topology, the personas, and the persona loader. Accept: importing the graph
   runs the startup checks cleanly.
4. **`route` plus `context`** (the core verification). Wire the route tool and
   persona injection, with a single `intake -> done` edge. Accept: the model calls
   `route("done")` and the run ends.
5. **Mid-run persona and tool-set switch** (the point of the PoC). Add a read-only
   node and a write node. Accept: within **one user prompt** the model works in
   intake, routes to the read-only node, uses its tools, routes again, and uses the
   write tools -- with no second user input.
6. **Guards, loop counters, and the approval gate.** Add the remaining nodes and
   edges, the mock tools, and the `publish_external` gate. Accept: a review
   rejection increments the loop counter; past the cap the flow escalates; the
   publish confirmation appears; after a decline the `publish -> done` guard does
   not pass.
7. **Tests** (see below).

## Testing

Three layers, run with the Node test runner (no dependencies, TypeScript run
directly). No test ever calls a real provider.

| Layer | Under test | Double | Assertions |
| --- | --- | --- | --- |
| pure functions | startup checks, guards (including counter variants and purity), transition commit order, persona parsing | none | startup throws or not, guard verdicts, effect then payload then node then history, loop cap |
| stub doubles | route tool execution, the extension hooks | stub extension API (records `setActiveTools` / `appendEntry`), stub context (`hasUI`, `ui.confirm`) | illegal transition / guard rejection throws, terminate only on terminal, tool-set switch, persona text, approval approve / decline / no-UI |
| session E2E | the full loop with scripted model output | faux provider | transition sequence, per-turn persona injection, illegal route yields an error result, no-UI publish is blocked, `route("done")` is rejected while `approved` is missing |

The fake provider scripts model output (assistant messages, tool calls, text) and
can inspect each request's context, which is how persona injection is asserted.
Session-level tests build a real agent session with in-memory session and settings
managers; project resources are discovered through the production path.

Not tested: model behavior itself (scripted output is deterministic by
construction), crash matrices, and real providers.

## Non-goals and known gaps

Non-goals -- do not build these along the way:

- multi-tenancy, quotas, rate limits, cost caps, model downgrades, model tiers;
- a headless host, CLI, SDK driver, or process boundary;
- Postgres or custom persistence; value registers (the `values` API is unreachable
  from the stable extension surface);
- cross-run orchestration (a new run or session per transition), sub-session
  derivation (sub-agents, worktrees);
- real domain tools (everything is mocked).

Known gaps -- recorded, not fixed as bugs:

1. A model that never calls `route` stalls the flow at the current node.
2. Transitions and audit entries are separate commits; a crash can lose one
   transition.
3. The persona is injected on every LLM call, costing persona tokens each turn in
   exchange for zero dedup logic.
4. Guard purity holds only insofar as the registers are the input; the approval
   result (`facts.approved`) is written by a hook, so the end-to-end path is not
   pure -- only the guard functions are.
5. Tool policy is narrowed by the persona whitelist, but the replay policy is a
   registration-time property that personas cannot change (the mock tools need no
   replay semantics).

## Appendix: design patterns this PoC relies on

- **Topology as data with startup validation.** Reachability and exit closure are
  checked at startup, so configuration errors surface then, not as runtime
  surprises.
- **Open dispatch, closed validation.** The model may request any transition, but
  only a declared pair that passes its guard takes effect. An illegal request comes
  back as a readable error result and the model reroutes.
- **Data and decision are separate.** The review score comes from the model; the
  jump is decided by a pure function.
- **Two channels for records.** Runtime state serves "now"; the audit entry serves
  "history". They are kept apart.
- **A host-agnostic pure core.** Topology and guards import no host package, so
  changing hosts touches only the assembly layer.
