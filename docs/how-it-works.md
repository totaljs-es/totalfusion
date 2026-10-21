# How it works

```
  Your code: a Total.js action, an API route, a Flow, or any Node.js program
        |   fusion.python(...)   fusion.rust(...)   fusion.stream(...)
        v
  TotalFusion, in your Node.js process
        pool of workers, queue, timeouts, cancellation, recycling, health check, events
        |   frames over the standard input and output: JSON plus raw binary parts
        v
  A worker process, one of many
        Python (python/worker.py)  or  Rust (the totalfusion crate)
        |
        v
  Your function
```

Each worker is a process (Python, or a Rust binary) that talks to Node.js over stdin/stdout with length-prefixed frames (protocol version 2: JSON for the structure plus raw binary parts, see [lib/protocol.js](../lib/protocol.js)). Calls carry an id, so responses never mix under concurrency. Workers start on demand, are replaced when they crash, exit when the parent dies and do not keep your Node.js process alive while idle.

Measured on one machine (Python 3.15, Node 24, macOS arm64), warm workers, JSON payloads:

| Scenario | p50 | p99 |
|---|---|---|
| `child_process` spawn per call | 17.6 ms | 19.8 ms |
| TotalFusion, small call | 0.07 ms | 0.12 ms |
| TotalFusion, 1 MB string in JSON, round trip | 3.0 ms | 4.4 ms |
| TotalFusion, 1 MB `Buffer`, round trip | 0.5 ms | - |
| TotalFusion, 32 MB `Buffer`, round trip | 14 ms | - |
| TotalFusion, 100 MB `Buffer`, round trip | 43 ms | - |
| TotalFusion, 40 MB `Float32Array`, round trip | 18 ms | - |

With a real library (NumPy in a virtual environment, nearest neighbours over 50,000 vectors of 128 dimensions, see [examples/components/vectors.py](../examples/components/vectors.py)): the worker starts and builds the index once (about 145 ms with a warm disk cache), then every call takes about 3 ms (p50), against about 98 ms when a process is spawned per call.

Throughput with 4 workers and trivial calls: about 23,000 calls/s. These numbers are a starting point, not a benchmark suite. Binary data does not go through JSON (see [Binary data](binary-data.md)).

## The protocol

Every message is a frame (all the integers are `uint32`, big endian):

```
total | json length | json | count | length of each part | the parts
```

The JSON holds the structure of the message and the binary data travels raw after it, referenced from the JSON as `{ "$bin": index, "type": "Float32Array" }`. The messages are `call`, `cancel`, `credit` (backpressure), `ping` and `bye` from Node.js, and `ready`, `chunk`, `res` and `pong` from the worker. The details are in [lib/protocol.js](../lib/protocol.js) and in the comments of the worker of each language; the Python and the Rust worker speak exactly the same protocol, which is why every feature works with both.

## Contracts

A function declares what it takes and returns with `@action(...)` in Python or `.input()`/`.output()`... in Rust. The contract is read without running anything: Python is read as text (an AST), and a Rust worker prints it with `--describe`. `fusion.describe(runtime)` returns it, and `fusion.register()` turns it into actions of Total.js.

## Adding a runtime

A runtime is an adapter plus a worker that speaks the protocol. See [Go](go.md) for the one that is planned, and [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-runtime) for what an adapter must provide.
