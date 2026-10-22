# Total.js with NumPy and Rust

Three examples in one Total.js 5 application: a Python contract becomes an Action backed by NumPy, a Rust contract becomes another Action, and a JavaScript Action sends a typed array to NumPy as raw bytes. The HTTP interface is JSON.

## Prepare

From the root of the TotalFusion clone:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r examples/totaljs-numerics/requirements.txt
cargo build --release --manifest-path examples/rust/Cargo.toml
cd examples/totaljs-numerics
npm install
TOTALFUSION_PYTHON="$(cd ../.. && pwd)/.venv/bin/python" npm start
```

The start command uses an **absolute interpreter path**, because the worker runs with the Python components as its working directory.

On Windows create the venv with `py -m venv .venv`, install with `.venv\Scripts\python.exe -m pip install -r examples/totaljs-numerics/requirements.txt`, and set `TOTALFUSION_PYTHON` to the absolute path of that interpreter before `npm start`. The application selects `worker.exe` automatically. Rust must be installed to build the worker; it is unnecessary when running an already built binary.

The application listens on port 8001 (`PORT` overrides it). `TOTALFUSION_RUST_BINARY` can select another worker by absolute path. NumPy and Rust are both required; startup reports a missing dependency and exits. No dependency is installed by the application.

## Verify the running example

In another terminal, from this example directory:

```bash
npm run verify
```
This checks all three HTTP operations and rejects missing input, empty arrays, constant arrays and an invalid Rust limit. Set the same `PORT` if you changed it for the server.

## NumPy as an Action

```bash
curl -s http://localhost:8001/api/ -H 'content-type: application/json' \
  -d '{"schema":"statistics_summarize","data":{"values":[1,2,3,4]}}'
```

The result contains `count: 4`, `mean: 2.5`, `std: 1.118033988749895`, `min: 1` and `max: 4`. Standard deviation uses the population convention (`ddof=0`).

The contract in [statistics.py](python/statistics.py) registers `statistics/summarize`, which also works in server code:

```js
const result = await ACTION('statistics/summarize', { values: [1, 2, 3, 4] }).promise();
```

Total.js validates the list before Python runs. NumPy checks that the list is non-empty and finite. The function declares `mcp=True`; the MCP endpoint remains disabled in the example configuration. See [Total.js integration](../../docs/total5.md) for authentication and exposure.

## Rust as an Action

```bash
curl -s http://localhost:8001/api/ -H 'content-type: application/json' \
  -d '{"schema":"collatz_longest","data":{"limit":10}}'
```

The result contains `number: 9` and `steps: 20`. The [existing Rust example](../rust/src/main.rs) declares the input, output and MCP contract; registering it with `runtime: 'rust'` makes `collatz/longest` available to `ACTION()` and the API route.

## Binary arrays between JavaScript and NumPy

```bash
curl -s http://localhost:8001/api/ -H 'content-type: application/json' \
  -d '{"schema":"arrays_normalize","data":{"values":[1,2,3,4]}}'
```

The returned values are approximately `[-1.342, -0.447, 0.447, 1.342]`. [The Total.js definition](definitions/fusion.js) converts the input to a `Float32Array`, sends it through TotalFusion and receives another typed array. Python uses `np.frombuffer()` to read the incoming buffer. Only the HTTP response converts the result back to a JSON list.

An empty list or a constant list produces a validation error. For example, `values: [2,2,2]` cannot be normalized because its standard deviation is zero.

See the [simple Python application](../totaljs-app/README.md) for streaming over SSE and development reload.
