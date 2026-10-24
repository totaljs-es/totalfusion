# Tutorials

Each tutorial builds something small and real, step by step. Every one has an application that you can run ([examples/tutorials](../../examples/tutorials)) and a test of the project that runs it on every change, so the commands and the answers on the page are the ones that work.

| | You will | Needs |
|---|---|---|
| [1. A Python function as an API and as a tool for an AI agent](01-python-action-and-mcp.md) | Write a function with a contract, serve it from Total.js with validation, offer it to an agent over MCP and edit it while it runs | Node.js 20, Python 3.9, and a Total.js 5 with the MCP endpoint for the part of the agent |
| [2. Run the code of third parties in the sandbox of WebAssembly](02-wasm-sandbox.md) | Load modules of customers, watch a hostile one fail to read files, see the environment, write or connect, and cut off one that never returns | Node.js 20, Go 1.24 to build the modules |

More are planned: stream the output of a model as Server-Sent Events, heavy work in Go or Rust without blocking Node.js, and a flow with alerts. They will be added here as they are written and tested.

New to TotalFusion? Start with [Getting started](../getting-started.md); the tutorials go further into one use each.
