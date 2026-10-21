# Working with the workers

A runtime is a **pool of worker processes** that Node.js supervises. They are started on demand (`workers` is the size of the pool), every call waits in a bounded queue (`maxQueue`) until a worker has room, and a worker that dies is replaced. A call is never repeated by itself. The options are listed in the [reference](reference.md#options).

## Several calls at the same time

By default a worker runs **one call at a time** and the work is spread over the processes. With `concurrency: N` each worker runs up to N calls at once, which is what you want when a call spends most of its time waiting, and for Rust, where every call runs in its own thread.

```js
fusion.configure({ python: { workers: 1, concurrency: 64 } });   // 64 calls waiting for an API at once
fusion.configure({ rust: { binary, workers: 1, concurrency: 8 } });   // 8 threads in one process
```

| Scenario | Configuration | Time | Processes / memory |
|---|---|---|---|
| Python, 64 calls that wait 0.2 s | 4 workers, `concurrency: 1` | 3.23 s | 4 / 94 MB |
| | 4 workers, `concurrency: 16` | 0.21 s | 4 / 93 MB |
| | 1 worker, `concurrency: 64` | 0.21 s | 1 / 24 MB |
| Rust, 8 CPU jobs of 0.33 s (8 cores) | 1 worker, `concurrency: 1` | 2.68 s | 1 |
| | 4 workers, `concurrency: 1` | 0.74 s | 4 |
| | 8 workers, `concurrency: 1` | 0.60 s | 8 |
| | 1 worker, `concurrency: 8` | 0.49 s | 1 |

- **The next call goes to the least loaded worker**, and a new worker is started only when the room of the existing ones is not enough.
- **Python:** `async def` functions overlap, and `def` functions run in threads. Because of the GIL, pure-Python computation does not speed up that way (use more `workers` for it); waiting for a network, a disk or a library that releases the GIL does. Calls that overlap in a worker **share its module state**: a global that a function modifies is not safe unless you protect it.
- **Rust:** the handlers must be `Send + Sync`, which the compiler checks. The calls of a worker share its memory, so one loaded model serves all of them.
- **A call that cannot be cancelled costs the worker.** After a timeout the worker is asked to cancel the call; if it cannot (a `def` function in Python that does not return, a Rust function that never looks at `is_cancelled()`), the worker is killed after `cancelGrace` and **the calls that were running next to it fail** with `WORKER_CRASHED`. A crash does the same. Async functions in Python and functions that check `is_cancelled()` in Rust are cancelled alone.
- **A stream keeps its slot until it ends.** A consumer that stops reading does not block the other calls of the worker, but it does hold one slot until the stream times out or is cancelled.
- **Recycling and the health check wait for the calls in progress:** a worker that reaches `maxCalls` leaves when the last of its calls ends, and only workers with nothing running are pinged.
- `fusion.stats()` shows `running` (calls in progress) for the pool and for every worker.

## Keeping workers healthy

Libraries for machine learning tend to leak memory, and a process can get stuck. Two mechanisms keep the pool in shape, and neither makes a call fail.

**Recycling.** A worker is replaced after `maxCalls` calls or as soon as it uses more than `maxMemory` (`512`, `'512mb'`, `'1.5gb'`). The replacement **starts first**; the old worker keeps serving until the replacement is ready, then it leaves as soon as it is idle (its `@shutdown` hooks run). With a single worker and a model that takes seconds to load, nobody waits for the restart. The limits are therefore soft: the old worker may serve a few more calls while the replacement loads, and for a moment two workers exist, so allow for that memory. If the replacement cannot start, the old worker stays and no new attempt is made for a minute.

With the DistilBERT worker of 1.35 GB and `maxCalls: 100`, 450 calls were served with two replacements: the slowest call took 32 ms (no stall while a new worker loaded the model), the pool peaked at 2.7 GB with both workers alive and went back to 1.35 GB. The median rose from 5-7 ms to 16 ms while a worker was loading, because both compete for the CPU.

Memory is the resident size on Linux, the physical footprint on macOS (the value Activity Monitor shows, compressed memory included) and the private bytes on Windows (the tests that check it run on all three systems). On other systems it is not reported, `maxMemory` has no effect and Node.js emits a warning.

**Health check.** Every `healthInterval` (10 s by default) idle workers get a ping. One that does not answer within `healthTimeout` (10 s) is killed and replaced at once, so the next call does not wait for a model to load. Only idle workers are checked: a busy worker is protected by the `timeout` of its call, and a long computation that holds the GIL is never mistaken for a dead worker.

`fusion.stats()` shows what is going on:

```js
fusion.stats().python
// { workers: 1, ready: 1, busy: 0, running: 0, queued: 0,
//   recycled: { calls: 2, memory: 0, reload: 0 }, unresponsive: 0,
//   details: [{ pid: 67025, ready: true, busy: false, running: 0, calls: 32, memory: 1417674752, age: 6120, recycling: false }] }
```

## Observing the workers

`fusion` is an `EventEmitter`. Use it for logs and metrics; every event carries the `runtime` it is about.

```js
fusion.on('worker:exit', e => log.warn('worker', e.pid, 'ended:', e.reason));
```

| Event | When | Data |
|---|---|---|
| `worker:ready` | A worker is ready to take calls. | `pid`, `startedIn` (ms) |
| `worker:exit` | A worker ended. | `pid`, `code`, `signal`, `running` (calls it had), `calls`, and `reason`: `crash`, `recycled` (replaced on purpose), `unresponsive`, `start-failed` or `shutdown` |
| `worker:recycle` | A worker is going to be replaced. | `pid`, `reason` (`calls`, `memory` or `reload`), `memory`, `calls` |
| `worker:unresponsive` | An idle worker did not answer the health check. | `pid`, `timeout` |
| `call:retry` | A call that was declared idempotent is going to run again. | `fn`, `attempt`, `retries`, `pid` of the worker that died |
| `reload` | The code changed and the workers are being replaced. | `files`, `replaced` |

A listener that throws does not break the pool: Node.js emits a warning.

## Retrying a call that can be repeated

A call is **never repeated by itself**: if its worker dies it may have done part of its work, and repeating it could do it twice. If you know it is harmless to run it again (a calculation, a query, a conversion), say so and a worker that dies does not fail the call:

```js
await fusion.python('prices.convert', data, { idempotent: true });                 // one more try
await fusion.python('prices.convert', data, { idempotent: true, retries: 3 });
```

```python
@action(summary='Converts a price', input='*amount:Number', idempotent=True)       # in the contract: Total.js does it for every call
```

In Rust, `.idempotent(true)` after the function. The call runs again on another worker, first in the queue, up to `retries` times (default 1); then it fails with `WORKER_CRASHED` as usual. This is what saves the calls that were running next to a call that had to be killed (see [Several calls at the same time](workers.md#several-calls-at-the-same-time)). It does **not** repeat a call that timed out, one that failed with an error of its own, a stream, or anything while the pool shuts down, and a function that kills its worker every time costs `retries + 1` workers, no more. The timeout counts for every attempt.
