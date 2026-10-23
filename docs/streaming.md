# Streaming

A Python function that **yields** is a stream: each `yield` reaches Node.js as soon as it happens. Generators can be `def` or `async def`.

```python
# python/llm.py
def generate(data):
    for token in model.generate(data['prompt']):
        yield token
```

```js
for await (const token of fusion.python.stream('llm.generate', { prompt: 'Hello' })) {
    process.stdout.write(token);
}
```

`fusion.stream('python', fn, args, options)` and `fusion.python.stream(fn, args, options)` return an async iterable; `.toArray()` collects everything.

- **Backpressure.** The worker may run ahead of the consumer by `highWaterMark` chunks (16 by default). Each chunk you read gives it one more. A slow consumer slows the generator down instead of filling memory: with `highWaterMark: 4`, after reading 2 chunks an endless generator had advanced only to its 6th, and with no limit it kept running.
- **Cancellation.** Leaving the loop (`break`, `return`, an exception) or aborting the `AbortSignal` stops the generator in Python and frees the worker. An `async def` generator is interrupted where it waits; a `def` generator stops between two chunks, and one that blocks without yielding is killed after `cancelGrace`, like any synchronous function.
- **Timeout.** For a stream `timeout` is the longest time **without progress**: no chunk produced and none read. A stream can last as long as it needs while it keeps moving.
- **Errors.** The chunks that were produced before a failure are delivered first, then the error with its Python traceback.
- A generator called with `fusion.python()` fails with `STREAMING_FUNCTION`, and a normal function called with `stream()` is a stream of one chunk.
- Chunks can carry binary data like any other value.

Measured with a real model (DistilGPT2 on CPU, 40 tokens): the first token arrives after 61 ms and a new one every 7 ms. Cutting the stream after 5 tokens of a 500-token request stopped the generation in 43 ms.

## Server-Sent Events from a Total.js route

```js
ROUTE('GET /generate/', function($) {
    fusion.sse($, fusion.python.stream('llm.generate', { prompt: $.query.prompt }));
});
```

`fusion.sse($, stream)` sends every chunk as `data: <json>`, the end as `event: end` and a failure as `event: error`. If the browser disconnects, the generator is cancelled, so a model does not keep generating for nobody. As in the actions, only the message of a `ValueError` reaches the client.

## In Rust

A function registered with `.stream()` sends its chunks with `call.emit(value)?`:

```rust
App::new()
    .stream("count.up", |call: &Call| {
        for number in 0..call.args["n"].as_i64().unwrap_or(0) {
            call.emit(number)?;               // waits if the consumer is slow, fails if it stops reading
        }
        Ok(())
    })
    .run();
```

```js
for await (const number of fusion.rust.stream('count.up', { n: 10 })) console.log(number);
```

`emit` waits while the consumer has not read the chunks that the worker is allowed to run ahead (`highWaterMark`), and it fails with a cancelled error when the consumer leaves the loop, so `?` ends the stream. A function that is not a stream and is called with `stream()` is a stream of one chunk, as in Python. The measured behaviour (backpressure, cancellation, a consumer that stops reading) is the same for every runtime: the tests run against all of them.

## In Go

A function registered with `app.Stream()` sends its chunks with `call.Emit(value)`:

```go
app.Stream("count.up", func(call *totalfusion.Call) error {
	n, _ := call.Args.Get("n").AsInt()

	for number := int64(0); number < n; number++ {
		if err := call.Emit(number); err != nil { // waits if the consumer is slow, fails if it stops reading
			return err
		}
	}

	return nil
})
```

```js
for await (const number of fusion.go.stream('count.up', { n: 10 })) console.log(number);
```

`Emit` returns `totalfusion.ErrCancelled` when the consumer leaves the loop, so returning the error ends the stream. The context of the call (`call.Context()`) is cancelled at the same time.
