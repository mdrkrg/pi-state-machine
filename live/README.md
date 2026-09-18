# live orchestration sandbox

Run `pi` from this directory to load the orchestrator extension for manual
(live) testing. The extension wiring lives in `live/.pi/settings.json`; the
repo root `.pi/` holds development skills only, so running `pi` there does
not load the extension.

```sh
cd live
pi -nc
```

`-nc` (`--no-context-files`) suppresses ancestor `AGENTS.md` discovery, which
would otherwise inject the repo's development instructions into the live model
context and distort persona behaviour. Drop it only when you explicitly want
the repo context file.

## What to expect

- A `route` tool plus the node-scoped mock tools (`read_workspace`,
  `write_workspace`, `publish_external`).
- The `/orch:state` command prints the current `Registers`.
- Publishing requires UI confirmation; without UI the gate blocks the call.
- The first interactive run asks to trust this project folder (needed before
  `.pi/settings.json` is honoured).
