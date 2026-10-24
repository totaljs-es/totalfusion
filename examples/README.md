# Examples

Every example runs from a clone of the repository. The ones in the first table are scripts for Node.js; the ones in the second are applications of Total.js 5. Start with `basic.js`, or with the [tutorials](../docs/tutorials/README.md), which go step by step.

## Scripts for Node.js

| Example | What it shows | Needs |
|---|---|---|
| [basic.js](basic.js) | `fusion.python()` in any Node.js program, and what an error of Python looks like in JavaScript. `node examples/basic.js` | Python 3.9 |
| [streaming.js](streaming.js) | A Python generator as an async iterable, and how leaving the loop stops it. `node examples/streaming.js` | Python 3.9 |
| [rust.js](rust.js) | The Rust worker of [rust](rust): the longest Collatz chain below 3 million, a mistake of the caller and the `doctor`. Build it first: `cd examples/rust && cargo build --release` | Rust |
| [go.js](go.js) | The same worker in [Go](go). Build it first: `cd examples/go && go build -o worker` | Go 1.21 |
| [wasm.js](wasm.js) | The same function as a module of WebAssembly in a sandbox, from [wasm](wasm). Build it first: `cd examples/wasm && GOOS=wasip1 GOARCH=wasm go build -buildmode=c-shared -o module.wasm` | Go 1.24 |

[components](components) has the Python functions that `basic.js` and `streaming.js` call (the standard library only), and others that use scikit-learn, NumPy and PyTorch (they need those libraries in your Python).

## Applications of Total.js 5

| Example | What it shows |
|---|---|
| [tutorials](tutorials) | The application of each tutorial. A test of the project starts it and checks what the page says. |
| [totaljs-app](totaljs-app) | Actions, an API route, Server-Sent Events and reload on edit, with Python. `npm install && npm start` |
| [totaljs-numerics](totaljs-numerics) | NumPy statistics, a Rust action and typed arrays as binary data. Its README says how to prepare it. |

The scripts and the applications use the workers that are in this repository, so the paths are relative to it. In your own project the import is `require('totalfusion')` and the paths are yours.
