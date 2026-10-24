# Instructions for GitHub Copilot

The full instructions of this repository are in `AGENTS.md`. The ones that matter most:

- TotalFusion extends Total.js 5 with Python, Rust, Go and WebAssembly. Plain JavaScript (tabs, `'use strict'`), no dependencies, no TypeScript.
- Run `npm test` before you say that something works. A test must be able to fail: break the code on purpose and see it fail.
- The documentation is tested (`tests/docs.test.js`): do not write numbers from memory, run it.
- The standard output of a worker carries the protocol: write to the error output.
- The MCP endpoint has no authentication by default: never turn it on in an application that listens on a public address.
- Do not commit built workers or modules (`target/`, `plugins/*.wasm`, `__pycache__`).
