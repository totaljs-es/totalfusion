# Use cases

Each case says **what was run** and what was measured, so you can tell a result from an idea. All the numbers come from one machine (8 cores, macOS, Node.js 24), and they show orders of magnitude, not guarantees.

## Machine-learning inference behind an API

**Goal:** a model that lives in Python, served as an action of Total.js.

**How:** load the model in `@startup`, declare the contract, `preload` it, and `warmup` at boot.

```python
@startup
def load():
    global pipe
    pipe = pipeline('sentiment-analysis', model=MODEL)

@action(summary='Detects the sentiment of a text', input='*text:String', output='label:String\nscore:Number', mcp=True)
def analyze(data):
    return pipe(data['text'])[0]
```

**Run and measured:** DistilBERT with PyTorch ([examples/components/sentiment.py](../examples/components/sentiment.py)). A call takes about 5 to 7 ms once the worker is warm; the first request after `warmup` through the MCP endpoint took about 22 ms; each worker uses 1.35 GB, so start with one or two. A scikit-learn forest ([classifier.py](../examples/components/classifier.py)) answered in 7 ms. See [Models and memory](python.md#models-and-memory).

## Let AI agents call your functions

**Goal:** an agent can use a function of yours as a tool, with the arguments checked.

**How:** add `mcp=True` (`.mcp(true)` in Rust, `.MCP(true)` in Go) to the contract and enable the MCP endpoint of Total.js. The tool and its schema come from the contract.

**Run:** the endpoint was called with `tools/list` and `tools/call`: only the functions that say `mcp` are listed, the schema has the `input`, `query` and `params` sections, an invalid argument is rejected by Total.js, and a function that does not say `mcp` answers "Unknown tool". Remember that the endpoint has no authentication unless you add it: see [Security](security.md).

## Show a model's output as it is produced

**Goal:** the user sees the text of a language model while it is generated, and the model stops if they leave.

**How:** a Python generator (`yield` per token) and `fusion.sse($, stream)` in a route.

```python
def generate(data):
    for token in model.generate(data['prompt']):
        yield token
```

```js
ROUTE('GET /generate/', $ => fusion.sse($, fusion.python.stream('llm.generate', { prompt: $.query.prompt })));
```

**Run and measured:** a real model (DistilGPT2, CPU, [generate.py](../examples/components/generate.py)) gave the first token after 61 ms and a new one every 7 ms, and cutting the stream after 5 tokens of a 500-token request stopped the generation in 43 ms. The Server-Sent Events route was run in a Total.js application with a Python generator (one event every 0.4 s, the generator is cancelled when the browser leaves). The two pieces were not chained in one test with the language model. See [Streaming](streaming.md).

## Heavy CPU work without blocking Node.js

**Goal:** a calculation that takes seconds must not freeze the application.

**How:** write it in Rust or Go and call it with `fusion.rust(...)` or `fusion.go(...)`; let one process use all the cores with `concurrency`.

**Measured:** the longest Collatz chain below 3 million, the same algorithm in each language. Optimized JavaScript takes 1.2 s and Rust 0.33 s (3.6 times faster; the naive JavaScript is 14 times slower than Rust), and pure Python is 48 times slower than Rust. Eight of those jobs take 9.1 s in JavaScript **blocking the event loop the whole time**, against 0.7 s on four Rust workers with 1 ms of delay in the event loop. The same test run again with a Go worker next to the Rust one, on the same day and machine (three alternating runs, and another implementation of the optimized JavaScript, 0.95 s): Go took 0.48 to 0.50 s and Rust 0.36 s, and eight jobs took 7.5 s in JavaScript against 1.0 to 1.1 s on four Go workers and 0.75 to 0.84 s on four Rust workers. See [Rust](rust.md), [Go](go.md) and the examples in [examples/rust](../examples/rust) and [examples/go](../examples/go).

## Vector search and numerical work with NumPy

**Goal:** use NumPy (or any numerical library) from Node.js without paying a process start per call.

**Measured:** nearest neighbours over 50,000 vectors of 128 dimensions ([vectors.py](../examples/components/vectors.py)): the worker builds the index once (about 145 ms), then every call takes about 3 ms, against about 98 ms when a process is started per call. An array of 10 million `float32` (40 MB) makes the round trip in 18 ms as a `Float32Array`, with no base64 and no JSON. See [Binary data](binary-data.md).

## Call slow things at the same time

**Goal:** many calls that spend their time waiting (an API, a database) should not each need a process.

**How:** `async def` functions in Python and `concurrency: N`.

**Measured:** 64 calls that wait 0.2 s each take 3.23 s on 4 workers with one call at a time, and 0.21 s with `concurrency: 64` on a single worker that uses 24 MB instead of 94 MB. See [Several calls at the same time](workers.md#several-calls-at-the-same-time).

## Send big files and arrays without base64

**Goal:** images, audio or arrays go to a worker and come back, and the transfer does not dominate.

**Measured:** a 1 MB buffer makes the round trip in 0.5 ms, 32 MB in 14 ms and 100 MB in 43 ms; as base64 inside JSON the same bytes take 4.4 ms and 145 ms for 1 MB and 32 MB, and 100 MB does not fit (it exceeds the JSON limit). A sketch of an image function (`Image.open(io.BytesIO(data['image']))` and back) is in [Binary data](binary-data.md); that sketch was not run, the transfer was.

## Edit the code while the application runs

**Goal:** see the effect of a change in the next call, with no restart.

**Run:** in [examples/totaljs-app](../examples/totaljs-app), editing `python/words.py` while the application ran changed the answer of the next request (a count of 3 became 300), and no call was lost. In the tests, calls made while the workers were being replaced all succeeded. See [Development](development.md).

## Several runtimes in the same application

**Run:** both runtimes can be configured in the same `fusion` and called side by side, each with its own pool (`fusion.python(...)`, `fusion.rust(...)` and `fusion.go(...)`). A pipeline that chains them (for example a model in Python and a post-processing step in Rust) was **not** built as an example.

## Where it does not fit

- **Light work on small data.** JavaScript in the same process pays no transfer: it wins. A call to a worker costs 0.03 ms (Rust and Go) to 0.07 ms (Python) of overhead, which is nothing for real work and everything for adding two numbers.
- **Code you do not trust.** A worker is not a sandbox: see [Security](security.md).
- **Very many Node.js processes.** Every process has its own pool of workers, so with the cluster mode of Total.js the workers (and their models) multiply by the number of processes.
