# Rust

Write the functions in Rust, build a binary, and call it like the Python ones. A Rust worker is an **isolated process** that speaks the same protocol, so everything in this documentation applies to it as well: the pool, timeouts, cancellation, [binary data](binary-data.md), [streaming](streaming.md), [recycling and health checks](workers.md#keeping-workers-healthy), Total.js actions, MCP tools and the `doctor`.

## Write a worker

```rust
// rust/src/main.rs
use totalfusion::{object, App, Call, Error};

fn main() {
    App::new()
        .function("collatz.longest", |call: &Call| {
            let limit = call.args["limit"].as_i64().ok_or_else(|| Error::invalid("limit must be a number"))?;
            Ok(object! { "number" => limit })   // the real work goes here
        })
        .summary("Finds the number with the longest Collatz chain")
        .input("*limit:Number")
        .mcp(true)
        .run();
}
```

## Build it and call it

The crate is not on crates.io: the npm package ships its sources, so the `Cargo.toml` of your worker points to them:

```toml
[dependencies]
totalfusion = { path = "../node_modules/totalfusion/rust" }
```

```bash
cargo build --release
```

```js
fusion.configure({ rust: { binary: './rust/target/release/worker', workers: 4 } });

const result = await fusion.rust('collatz.longest', { limit: 3000000 });

for await (const chunk of fusion.rust.stream('count.up', { n: 10 })) { /* a function registered with .stream() */ }

// Total.js: the functions that declare their contract become actions
await fusion.register({ runtime: 'rust', rust: { binary: './rust/target/release/worker' } });
```

The guide of the crate, with the whole API, is in [rust/README.md](../rust/README.md). A complete example is in [examples/rust](../examples/rust).

## Good to know

- **Nothing is compiled for you.** `binary` is the path of a worker you built (or got precompiled), so the people who only run the application do not need Rust. `fusion.doctor('rust')` and `npx totalfusion doctor --binary ./worker` check that the file exists, can be executed, answers, speaks the same protocol version and is not a debug build.
- **A panic fails one call, not the worker.** A crash of the process is a `WORKER_CRASHED` error and the worker is replaced; Node.js never goes down.
- **Same options as Python:** `workers`, `concurrency`, `timeout`, `maxQueue`, `maxCalls`, `maxMemory`, `healthInterval`, `cancelGrace`... plus `args`, `env` and `cwd` for the process. Every call of a worker runs in its own thread, so `concurrency` makes one process use all the cores (see [Several calls at the same time](workers.md#several-calls-at-the-same-time)).
- **Contracts are declared in code**, with the same names as `@action` in Python (`summary`, `input`, `output`, `query`, `params`, `permissions`, `mcp`...). The binary prints them with `--describe`.
- **Where Rust pays off.** Heavy CPU work that should not block Node.js and that can use several cores. For the longest Collatz chain below 3 million (the same algorithm in each language, eight cores): optimized JavaScript takes 1.2 s and Rust 0.33 s (3.6x; the naive JavaScript most people write is 14x slower than Rust), and pure Python is 48x slower than Rust. Eight of those jobs take 9.1 s in JavaScript, **blocking the event loop the whole time**, and 0.7 s on four Rust workers, which leave the event loop free (1 ms of delay). A call that does nothing costs 0.03 ms. For light work on small data, JavaScript in the same process wins: it pays no transfer.
- **Windows:** the SDK points the standard output of the process to the error output, as it does on Unix, so `println!` is harmless. Windows does not let anything overwrite an executable that is running, so on Windows the worker runs from a **copy** (in the temporary folder, named after the time and size of your build) and the file you build stays free: `cargo build` can replace it while the workers are running, and `fusion.watch('rust')` picks the new build up. The copies of old builds are removed. `shadowCopy: true` does the same on any system, `shadowCopy: false` turns it off. The tests of the project run this on Windows.

## Rust or Python

| | Python | Rust |
|---|---|---|
| What it is for | The ecosystem: machine learning, scientific computing, any Python library | Speed, many threads, a small footprint |
| Work per call | Calls overlap in the event loop or in threads, and the GIL limits pure-Python computation | Every call runs in its own thread: one process can use all the cores |
| Memory of a minimal worker | 24 MB (measured with the components of the tests) | 1 MB (measured with the example worker) |
| What you ship | Your `.py` files, and Python with its libraries on the machine | One binary. The machine does not need Rust |
| Change it while the app runs | Save the file | Build again (`cargo build --release`): `fusion.watch('rust')` replaces the workers |
| Contracts | `@action(...)` | `.summary().input().output()...` in code |

They can be used in the same application: each runtime has its own pool, and `fusion.python(...)` and `fusion.rust(...)` are independent.

## The API of the crate

The whole API, with every method, is in [rust/README.md](../rust/README.md). In short:

- `App::new().function(name, |call| ...)` registers a function that answers once, and `.stream(name, |call| ...)` one that sends chunks with `call.emit(value)?`.
- `call.args` is the argument as a `Value`; `call.args["key"]` never panics. `call.is_cancelled()` tells a long function that Node.js gave up.
- `Error::invalid("...")` is a mistake of the caller (Total.js sends its message to the client); `Error::new("...")` is a failure that stays in the log. A panic fails one call, never the worker.
- `.on_shutdown(|| ...)` runs when the worker is asked to stop. What you do in `main` before `run()` happens before the worker says it is ready.
- The metadata methods apply to the function registered just before them: `summary`, `input`, `output`, `query`, `params`, `permissions`, `user`, `sa`, `su`, `idempotent`, `timeout`, `id`, `mcp` and `action`.
