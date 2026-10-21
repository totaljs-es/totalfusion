# totalfusion (Rust)

Write functions in Rust and call them from Node.js and Total.js as `async` functions. This crate is the Rust side of [TotalFusion](../README.md): your program registers its functions and TotalFusion starts it, keeps a pool of workers, and talks to it through the standard input and output.

A worker is a normal binary and an **isolated process**: a panic fails only the call that caused it, and even a crash of the whole process never takes Node.js down. Nothing is compiled by TotalFusion: you build the worker (`cargo build --release`) or you get it precompiled.

```rust
use totalfusion::{object, App, Call, Error};

fn main() {
    App::new()
        .function("text.length", |call: &Call| {
            let text = call.args["text"].as_str().ok_or_else(|| Error::invalid("text must be a string"))?;
            Ok(object! { "length" => text.chars().count() })
        })
        .summary("Counts the characters of a text")
        .input("*text:String")
        .output("length:Number")
        .mcp(true)
        .run();
}
```

```js
fusion.configure({ rust: { binary: './rust/target/release/worker', workers: 4 } });

await fusion.rust('text.length', { text: 'Hello' });   // { length: 5 }
```

## Functions

- `.function(name, |call| -> Result<Value, Error>)` answers once.
- `.stream(name, |call| -> Result<(), Error>)` sends many chunks with `call.emit(value)?`. In JavaScript: `for await (const chunk of fusion.rust.stream(name, args))`. `emit` waits when the consumer is slow (backpressure) and fails when it stops reading, so `?` ends the stream.
- `call.args` is a `Value`. `call.args["key"]` never panics: a missing member is `Null`.
- `call.is_cancelled()` is true when Node.js gave up (timeout, abort). A long function should look at it from time to time. A function that never looks is killed after `cancelGrace` and the worker is replaced.
- `.on_shutdown(|| ...)` runs when the worker is asked to stop. What you do in `main` before `run()` (load a model, open a connection) happens before the worker says it is ready.

## Values

`Value` holds everything JSON can, plus binary data that never goes through JSON. `Vec<u8>` is a `Buffer` in JavaScript, `Vec<f32>` is a `Float32Array`, and so on for `i8`, `i16`, `u16`, `i32`, `u32`, `i64` (`BigInt64Array`), `u64` and `f64`. Build objects with `object! { "key" => value }` and arrays with `Value::array([1, 2, 3])`; read them with `as_str()`, `as_f64()`, `as_i64()`, `as_bool()`, `as_bytes()`, `as_f32s()`, `as_f64s()`, `as_i32s()`, `as_array()` and `as_object()`.

NaN and infinity cannot be sent (JSON has no such numbers): the call fails with `NOT_SERIALIZABLE`.

## Errors

`Error::new("...")` is a failure of the function. `Error::invalid("...")` is a mistake of the caller (bad input): in Total.js its message is sent to the client, and the message of any other error stays in the log. `Error::named("DatabaseError", "...").with_code("E_DB")` gives the error a name and a code of its own. A panic becomes an error named `Panic`.

## Total.js

The methods that describe a function apply to the function registered just before them: `summary`, `input`, `output`, `query`, `params` (the schema syntax of Total.js, `*` means required), `permissions`, `user`, `sa`, `su`, `timeout`, `id` and `mcp`. A function that declares any of them, or calls `.action()`, becomes an action of Total.js with `fusion.register({ runtime: 'rust', rust: { binary } })`; the others stay callable from JavaScript but private. `mcp(true)` also exposes it to AI agents.

`./worker --describe` prints the contracts as JSON. This is what `register()` and `fusion.doctor('rust')` read, so nothing runs to learn them.

## Do not print to the standard output

It carries the protocol. On Unix the crate redirects it to the error output for you, so `println!` is harmless there, but use `eprintln!` to be safe everywhere (on Windows the standard output is not redirected).

## Requirements

Rust 2021 edition. The only dependency is `serde_json`. Tested with Rust 1.99 on macOS (Apple silicon).
