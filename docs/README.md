# Documentation

TotalFusion extends Total.js with other runtimes. These pages explain how to use it. The [README of the project](../README.md) is the short version.

## Start here

| | |
|---|---|
| [Getting started](getting-started.md) | Install it, call your first function, and make it an action of Total.js. |
| [Use cases](use-cases.md) | What it is good for, with the numbers that were measured. |
| [How it works](how-it-works.md) | The pool, the workers and the protocol. |

## The runtimes

| | |
|---|---|
| [Python](python.md) | Machine learning and any Python library. Available. |
| [Rust](rust.md) | Speed, threads and a small footprint. Available. |
| [Go](go.md) | Network and infrastructure code, many calls at once, easy to build for any system. Available. |

## Features that every runtime shares

| | |
|---|---|
| [Total.js 5](total5.md) | Actions, validation, permissions, API routes, MCP tools, Server-Sent Events and FlowStream. |
| [Binary data](binary-data.md) | Buffers and typed arrays without base64. |
| [Streaming](streaming.md) | Generators as async iterables, with backpressure and cancellation. |
| [Working with the workers](workers.md) | Concurrency, recycling, the health check, events and retrying. |
| [Errors and cancellation](errors.md) | The error codes and how a call is cancelled. |
| [Development and diagnosis](development.md) | Reload when the code changes, and the `doctor`. |
| [Security](security.md) | What it protects and what it does not. |
| [Reference](reference.md) | Every option, method and command. |

## About the project

[Changelog](../CHANGELOG.md) · [Contributing](../CONTRIBUTING.md) · [The Rust crate](../rust/README.md) · [The Go module](../go/README.md)
