# AGENTS.md: the Rust crate

The Rust side of TotalFusion: the crate `totalfusion` that a Rust worker depends on (`src/`), and the adapter `index.js` that starts a worker from Node.js. The whole API is in `README.md`; the rest of the project is in `../AGENTS.md`.

## Rules of this crate

- **The only dependency is `serde_json`.** The crate is not on crates.io: a worker points to it with `totalfusion = { path = "../node_modules/totalfusion/rust" }`.
- **The version of `Cargo.toml` is the one of `package.json`** (`tests/package.test.js` checks it).
- **Every call runs in its own thread, and a panic fails only that call** (`catch_unwind`). A crash of the process is a `WORKER_CRASHED` error that Node.js survives.
- **The standard output carries the protocol.** `app.rs` points it to the error output (`dup2` on Unix, `SetStdHandle` on Windows) and keeps the real one for the frames, so `println!` is harmless.
- **Backpressure is a credit:** `Call::emit` waits until the consumer has room and fails with a cancelled error when it leaves.
- **Memory** is per system (`memory.rs`): `/proc` on Linux, the footprint on macOS, the private bytes on Windows.
- `Value` holds JSON plus typed arrays that travel as raw bytes (`value.rs`); NaN and infinity are not JSON and are an error.

## Files

`src/lib.rs` (the exports), `app.rs` (the `App` builder, `run` and the messages), `value.rs`, `wire.rs` (the frames), `error.rs`, `memory.rs`, and `index.js` (the adapter: `create`, `describe`, `doctor`, `watchTarget`, and `shadowCopy` so that Windows can replace a binary that is running).

## Check a change

```bash
npm run test:rust                 # cargo test of the crate
node --test tests/rust.test.js    # the worker of the tests, run from Node.js
```

`rustfmt` formats the code. The worker that the JavaScript tests run is `../tests/rust`, built by `../tests/rust-build.js`; without `cargo` those tests are skipped.
