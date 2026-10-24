# Security policy

## Supported versions

TotalFusion is at version 0.1.0, and the latest release is the one that is supported.

## Reporting a vulnerability

Report it **privately**: open the *Security* tab of the repository and choose *Report a vulnerability* (private vulnerability reporting of GitHub). Please do not open a public issue for it. Say which version and which runtime (Python, Rust, Go or WebAssembly), the system, the steps to reproduce it and what an attacker could do. Do not include secrets.

## What is a vulnerability

- A module of WebAssembly that gets out of its sandbox: it reads or writes a file, sees the environment, opens a connection or affects the process that runs it.
- A malformed frame or a payload that crashes or exhausts the engine in Node.js.
- A function that reads the contracts or the environment (`doctor`, `describe`, `register`) running code that the documentation says it does not run.
- A message of an error that leaks to a client what the documentation says that it keeps in the log.

## What is not

- A worker of Python, Rust or Go is **not** a sandbox, and the documentation says so: it runs with the permissions of the process. Run only code that you trust, or use a module of WebAssembly. See [Security](docs/security.md).
- The MCP endpoint of Total.js has no authentication unless you add one. That is documented, and turning it on in an application that listens on a public address is a decision of whoever deploys it.
- A flaw in Node.js, V8, WASI, Python, Rust or Go themselves belongs to those projects. Tell them, and tell us if TotalFusion makes it reachable.
