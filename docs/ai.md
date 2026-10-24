# Using TotalFusion with AI assistants

Two things are in this page: how to give an assistant (or an agent) what it needs to **write code that uses TotalFusion**, and how your functions become **tools that an agent can call**. Every file mentioned here is kept true by a test of the project (`tests/agents.test.js`).

## What to give your assistant

| File | What it is | Give it when |
|---|---|---|
| [AGENTS.md](../AGENTS.md) | Instructions: how to use TotalFusion in an application, how the repository is organised, the commands, and the pitfalls to avoid. It is also in the npm package, at `node_modules/totalfusion/AGENTS.md`. | The assistant works in your application or in this repository. |
| [llms.txt](../llms.txt) | An index of the documentation, in the format of [llmstxt.org](https://llmstxt.org): one line and one link for each page. | The assistant can read links and you want it to choose what to read. |
| [llms-full.txt](../llms-full.txt) | All the documentation in one file. | The assistant cannot read links, or you want it to have everything at once. |
| [schemas/configure.schema.json](../schemas/configure.schema.json) | JSON Schema of `fusion.configure()` and of the options of a call. | To validate a configuration, or to let an editor complete it. |
| [schemas/contract.schema.json](../schemas/contract.schema.json) | JSON Schema of the contract of a function and of what a worker prints with `--describe`. | To write a worker in another language, or to check one. |

`llms.txt` and `llms-full.txt` are built from the pages of the repository (`node scripts/llms.js --write`), so they cannot be out of date: a test fails if they are.

If your assistant takes a block of instructions of your own, this is enough to start (it is the essence of `AGENTS.md`):

```
This project uses TotalFusion (https://github.com/totaljs-es/totalfusion) to call functions written in
Python, Rust, Go and WebAssembly from Total.js 5 and Node.js. Read node_modules/totalfusion/AGENTS.md first.
- A function that declares a contract (@action in Python, .summary().input() in Rust, .Summary().Input() in Go)
  becomes a Total.js action with fusion.register(); only functions that say mcp become tools for AI agents.
- The standard output of a worker carries the protocol: write to the error output.
- Check the setup with: npx totalfusion doctor --json
- A WebAssembly module runs in a sandbox (no files, no network, no environment); one module for each Fusion.
- The MCP endpoint has no authentication unless you add one: never expose it without.
```

## Your functions as tools for agents

A function with a contract and `mcp=True` (Python), `.mcp(true)` (Rust) or `.MCP(true)` (Go) is offered by the MCP endpoint of Total.js as a tool: its name, its description, the schema of its arguments and the schema of its result come **from the contract**, so you write them once. The [first tutorial](tutorials/01-python-action-and-mcp.md) does it from the start and shows the real answers of `tools/list` and `tools/call`.

Two things to decide before you do it for real: **which functions** the agent may call (an agent sees only what you say, so leave the rest without `mcp`), and **who may reach the endpoint** (it has no authentication unless you add one with `Total.mcp.auth`). See [Security](security.md).

## Let an agent check the environment

```bash
npx totalfusion doctor --json
```

It prints one JSON object, and the exit code says the result: `0` when everything is in order, `1` when something has to be fixed, `2` for a wrong usage.

```json
{
  "runtime": "python",
  "ok": false,
  "checks": [
    { "status": "error", "name": "Libraries", "message": "numpy used by stats needs to be installed", "fix": "/project/.venv/bin/python -m pip install numpy" }
  ],
  "text": "TotalFusion doctor: python ..."
}
```

Each check has a `status` (`ok`, `warn` or `error`), a `name`, a `message` and, when there is something to do, the exact command in `fix`. An agent can run the command of `fix` instead of guessing. For Python, the doctor reads components without importing them. For Rust and Go it executes the worker with `--describe`; for WebAssembly the host reads the module contract inside its sandbox. A native worker still has the permissions of its user during discovery: use a trusted binary. See [Development and diagnosis](development.md).

## For agents that work on the repository

The repository has the files that the common agents look for. They all lead to the same instructions, so there is only one text to keep true:

- `AGENTS.md`: the instructions. Each area of the repository (`go`, `rust`, `python`, `wasm`, `total5`, `tests`) has its own, with a `CLAUDE.md` that imports it, because Claude Code loads the `CLAUDE.md` of a folder when it works there.
- Codex reads `AGENTS.md` directly. Its four repo-local skill entry points are in `.agents/skills/`, and each links to the corresponding checklist in `.claude/skills/`. The checklist stays in one place.
- `CLAUDE.md` and `GEMINI.md`: they import `AGENTS.md`.
- `.github/copilot-instructions.md`: a short version for GitHub Copilot, with the rules that matter most.
- `.claude/skills/`: four skills for Claude Code (add a function to an application, diagnose a worker that fails, add a tutorial, verify a change). Each one is a checklist with the real commands.
- `.claude/settings.json`: the commands that are safe to run without asking (the tests, `npm run check`, read-only git).

## Codex

Start a Codex chat with this repository as the workspace. Codex reads the root `AGENTS.md` and instructions along the path to its working directory. When working in another area, read that area's `AGENTS.md` before editing it. If your chat started in another project, explicitly read this repository's instructions; mentioning its path does not change the chat's workspace.

The skills in `.agents/skills/` expose the same four workflows as Claude Code: add a function, diagnose a worker, add a tutorial and verify a change. Codex can select one when its description matches the task; you can also ask for it explicitly, for example `$totalfusion-diagnose-worker`. Each entry links to the maintained checklist, so updates to it apply to both agents.

The shared `.claude/settings.json` configures Claude Code. Codex uses the permissions of its own environment; these repository instructions do not grant filesystem access, network access or command approval. No Codex configuration change is required to read the instructions and skills.

For applications that install TotalFusion as a dependency, ask Codex to read `node_modules/totalfusion/AGENTS.md`; dependency instructions are not automatically loaded as application instructions. The repo-local skills are for a checkout of TotalFusion and are not shipped in its npm package.

See the official OpenAI documentation on [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) and [skills](https://learn.chatgpt.com/docs/build-skills) for discovery and invocation.

## What is verified

`tests/agents.test.js` checks that the paths and the commands that `AGENTS.md` and the skills mention exist, that `llms.txt` lists every page and that its links lead to files that exist, that `llms-full.txt` is what the pages say, that the schemas have the same options as the code, and that the files for each agent lead to `AGENTS.md`. It also checks that every Codex skill has the same discovery metadata as its shared checklist and that its link resolves to that checklist. What is **not** verified is how a given assistant uses these files: that depends on the assistant.
