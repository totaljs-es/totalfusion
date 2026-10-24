# Flow

Use your functions of Python, Rust, Go and WebAssembly as nodes of a **Total.js Flow**: draw the flow, set the function in the settings of the node, and the data of every message is the argument. TotalFusion brings seven components, in the group *TotalFusion* of the designer:

| Component | What it does | Inputs | Outputs |
|---|---|---|---|
| **Python**, **Rust**, **Go**, **WebAssembly** | Calls a function of that runtime with the data of the message | `Input` | `Result`, `Error` |
| **Stream** | Calls a function that sends chunks: every chunk is a message | `Start`, `Stop` | `Chunk`, `End`, `Error` |
| **Events** | Sends a message for every event of the workers that you choose | none | `Event` |
| **Stats** | Sends what the pools are doing | `Read` | `Stats` |

They use the same pools of workers as the rest of your application: a model that a Python node loads is loaded once.

## Install them

The components are offered in the catalog of the designer ("Download components"), like the ones of Total.js. The catalog reads a list of components, and TotalFusion has one: [total5/flow/db.json](../total5/flow/db.json). Add it to your Flow as its second list of components, the `components2` setting (in the `config` file of the Flow application):

```
components2 : https://raw.githubusercontent.com/totaljs-es/totalfusion/main/total5/flow/db.json
```

Open the designer, press *Download components* and import the ones you want from the group TotalFusion. (That address works when the repository is public. Until then, or if you prefer your own server, put the files of [total5/flow](../total5/flow) on it and build the list with the address of your files: `node node_modules/totalfusion/scripts/flow-db.js --base https://my.server/fusion/ --out db.json`.)

Then say where the workers are. Every FlowStream of Flow is a process of its own that loads `extensions.js` of your Flow application, so that is the place:

```js
// extensions.js of your Flow
exports.install = function(instance) {

	require('totalfusion').configure({
		python: { path: '/srv/models' },
		go: { binary: '/srv/workers/net' },
		wasm: { module: '/srv/plugins/rules.wasm' }
	});

};
```

`totalfusion` has to be installed in the Flow application (`npm install totalfusion`). The options are the ones of [`fusion.configure()`](reference.md#options). A node whose runtime is not configured sends an error message (`INVALID_CONFIG`) and the flow goes on.

## The components that call a function

Python, Rust, Go and WebAssembly are the same component with another runtime, so each one is visible at a glance in the designer. The settings:

- **Function** (`module.function`): the function to call, as in `fusion.python('module.function')`.
- **Timeout**: milliseconds, `0` for none.
- **Repeat the call on another worker if its worker dies**: only for a function that can be repeated with no harm (see [Retrying](workers.md#retrying-a-call-that-can-be-repeated)).

The data of the message is the argument, and the result goes out through `Result`. A failure goes out through `Error` as `{ code, message }`: the code of the error (`REMOTE_ERROR`, `TIMEOUT`, `NOT_FOUND`...) and the first line of its message, **without the traceback**. Do not connect that output straight to a public response. The node shows how many calls it made, or its last error.

## Stream

For the functions that send chunks: a Python generator, or a stream function of Rust or Go. The settings are the **runtime**, the function and the timeout (the longest time without a new chunk).

A message in `Start` starts a stream with the data as the argument. **Every chunk is a message** on `Chunk`, in order. When the stream ends, one message `{ chunks, cancelled }` goes out through `End`; a failure goes out through `Error` with the `code`, the `message` and how many `chunks` came before it. A message in `Stop` cancels the streams that are running (their `End` says `cancelled: true`), and so does stopping the flow or removing the node, so a model does not keep generating for nobody. WebAssembly modules cannot stream: their function is a stream of one chunk.

A stream of tokens from a model, a chunk at a time, into the rest of the flow: that is this node followed by whatever you want to do with each token.

## Events

A message for every event that you choose, as it happens. The settings: the events (separated by commas) and the runtime to watch (or all):

| Event | When |
|---|---|
| `worker:ready` | A worker started and is ready |
| `worker:exit` | A worker ended (`reason`: `crash`, `recycled`, `unresponsive`, `shutdown`...) |
| `worker:recycle` | A worker is being replaced (`reason`: `calls`, `memory`, `reload`) |
| `worker:unresponsive` | A worker did not answer the health check |
| `call:retry` | A call is repeated on another worker |
| `reload` | The code changed and the workers were replaced |

The message has the `event`, when it happened (`at`) and the data of the event (`runtime`, `pid`, `reason`...). The default events are the ones that need attention: `worker:exit`, `worker:recycle`, `worker:unresponsive`, `call:retry` and `reload`. Connect it to an email, a chat or a log, and the people in charge know that a worker stopped answering without anybody writing code. See [Observing the workers](workers.md#observing-the-workers).

## Stats

`fusion.stats()` as a message: for every runtime that started, how many workers it has, how many are ready or busy, the queue, the recycled workers and the memory of each one. It goes out when a message arrives in `Read`, and every N seconds if you set it (`0` is only on demand). The settings can be changed while the flow runs and the timer follows.

## What was verified

- Every component was run with the test harness of Flow that comes with Total.js 5 (`flow-test.js`): the results and the errors, the settings changing while it runs, the streams, the events and the timer. The tests are in [tests/flow.test.js](../tests/flow.test.js) and [tests/flow-logic.test.js](../tests/flow-logic.test.js).
- They were also installed and run in the **designer of Flow 11.1** (on macOS, with Node.js 24): they appear in the catalog from the list, they are imported into a FlowStream, a flow with Stats connected to Python ran and showed its calls in the node, Events showed the start of the worker, and the settings (the list of runtimes, the numbers, the check box) work. That was done by hand, once; the tests above are the ones that run in every change.
- The icons are the ones of the icon font of Flow, which is not the whole of Tabler: a name that the font lacks shows nothing. A test checks it.
- The tests above run on Linux, macOS and Windows in the continuous integration of the project. Not verified: Flow in the cloud service of Total.js.
