# Security

TotalFusion runs your code in other processes. This page says what that protects and what it does not.

## What TotalFusion does and does not do

- **A worker is not a sandbox.** It runs your code with your user's permissions, with your environment (pass `env` to restrict it), your file system and your network. Run only components you trust.
- **Nothing is downloaded, compiled or installed for you.** The worker of Python uses the standard library, and the libraries are yours. A Rust or a Go worker is a binary you built or got precompiled.
- **Agents see only what you expose.** An action is an MCP tool only if its function says `mcp`. The MCP endpoint of Total.js (`CONF.$mcp = true`) has no authentication unless you add one (`Total.mcp.auth`): turn it on only on a machine you control, and put authentication in front of it before anything else.
- **Total.js validates before your code runs.** The input, `query` and `params` are checked against the contract, and `permissions`, `user`, `sa` and `su` are enforced by the framework before the function is reached. Your function does not see the user.
- **Errors do not leak.** A `ValueError` in Python, `Error::invalid` in Rust or `Invalid` in Go is a mistake of the caller and its message reaches the client. Any other failure returns "The action failed" and the real error goes to the log (`onerror`), so paths, queries and secrets inside the messages of exceptions stay in your server.
- **Python function names are restricted** to modules inside your components directory. That protects you from mistakes (calling `os.system` through a typo), not from an attacker: it is not a security boundary.
- **Calls are never repeated by themselves.** A call that was running when its worker died may have done part of its work. Only a call you declare idempotent is repeated.
- **`"$bin"` is a reserved key** of the protocol and cannot appear in your data.

## Reporting a problem

Open an issue in the repository. Do not include secrets in it.
