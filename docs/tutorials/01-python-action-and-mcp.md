# 1. A Python function as an API and as a tool for an AI agent

You will write one Python function, and Total.js will serve it as an **API endpoint** with validated input and as a **tool that an AI agent can call**. You will change the function while the application runs and see the new answer at once. It takes about ten minutes, and it needs nothing but Python itself: no libraries to install.

The finished application is in [examples/tutorials/01-python-action-and-mcp](../../examples/tutorials/01-python-action-and-mcp), and a test of the project runs it on every change, so what this page says works.

## What you need

- Node.js 20 or newer and Python 3.9 or newer.
- This repository, and `npm install` in the folder of the tutorial (it installs Total.js 5 and links TotalFusion).

```bash
cd examples/tutorials/01-python-action-and-mcp
npm install
npm start
```

The application listens on `http://127.0.0.1:8000` and prints `TotalFusion actions: sentiment/analyze`. The rest of the page explains why.

## 1. The Python function

[python/sentiment.py](../../examples/tutorials/01-python-action-and-mcp/python/sentiment.py) reads a text and says if it is positive, negative or neutral:

```python
from totalfusion import action

@action(
    summary='Detects whether a text is positive, negative or neutral',
    input='*text:String // The text to read',
    output='label:String\nscore:Number',
    mcp=True
)
def analyze(data):
    words = [word.strip('.,;:!?"\'()').lower() for word in data['text'].split()]
    score = sum(word in POSITIVE for word in words) - sum(word in NEGATIVE for word in words)

    return {
        'label': 'POSITIVE' if score > 0 else 'NEGATIVE' if score < 0 else 'NEUTRAL',
        'score': score
    }
```

The decorator is the **contract** of the function, in the schema syntax of Total.js:

- `input='*text:String'`: the function takes a text, and `*` means it is required.
- `output=...`: what it returns.
- `summary`: one line for people, and for the AI agent that will read it.
- `mcp=True`: it is offered to agents. Without it, the function is an action but not a tool: **an agent sees only what you say**.

The function itself is plain Python. It does not know about Total.js, HTTP or JSON.

## 2. Register it in Total.js

[definitions/fusion.js](../../examples/tutorials/01-python-action-and-mcp/definitions/fusion.js):

```js
const fusion = REQUIRE('totalfusion');

exports.install = function() {

	fusion.register({ python: { path: PATH.root('python') }, watch: DEBUG });

	ROUTE('API  /api/  +sentiment_analyze  -->  sentiment/analyze');
};
```

`fusion.register()` reads the contracts of the folder `python/` **without running anything**, and creates a Total.js action for each function that declares one: `sentiment/analyze`. After that it is an action like any other: `ACTION('sentiment/analyze', ...)`, an API route, a Flow node. The second line is the route: a `POST` to `/api/` with `{ "schema": "sentiment_analyze", "data": ... }`.

## 3. Call it

```bash
curl -s -X POST localhost:8000/api/ -H 'content-type: application/json' \
  -d '{"schema":"sentiment_analyze","data":{"text":"I love how fast it works!"}}'
```

```json
{"label":"POSITIVE","score":3}
```

The Python worker started on the first call (a process that stays alive, so the next calls cost 0.07 ms of overhead, not the 17 ms of starting Python).

## 4. Invalid input never reaches Python

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST localhost:8000/api/ -H 'content-type: application/json' \
  -d '{"schema":"sentiment_analyze","data":{}}'
```

```
[{"name":"text","error":"The text to read","path":"text"}]
HTTP 400
```

Total.js validated the input against the contract, found that `text` was missing, and answered before Python ran. The message is the comment of the contract (`// The text to read`), so write it for the person who will read the error.

## 5. The same function as a tool for an AI agent

The file [config](../../examples/tutorials/01-python-action-and-mcp/config) has `$mcp : true`, which turns on the MCP endpoint of Total.js: `POST /$mcp/`, JSON-RPC over HTTP. An agent first asks which tools there are:

```bash
curl -s -X POST 'localhost:8000/$mcp/' -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

```json
{"jsonrpc":"2.0","id":1,"result":{"resultType":"complete","tools":[{"name":"sentiment_analyze","description":"Detects whether a text is positive, negative or neutral","inputSchema":{"type":"object","properties":{"input":{"type":"object","description":"Payload (request body) passed to this action.","properties":{"text":{"type":"string","description":"The text to read"}},"additionalProperties":false,"required":["text"]}},"required":["input"]},"outputSchema":{"type":"object","properties":{"label":{"type":"string"},"score":{"type":"number"}},"required":[]}}]}}
```

Everything an agent needs to use the function comes from the contract: the name, the description, the arguments and what it returns. You wrote none of it twice. Then it calls the tool:

```bash
curl -s -X POST 'localhost:8000/$mcp/' -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"sentiment_analyze","arguments":{"input":{"text":"This is terrible and broken"}}}}'
```

```json
{"jsonrpc":"2.0","id":2,"result":{"resultType":"complete","content":[{"type":"text","text":"{\"label\":\"NEGATIVE\",\"score\":-2}"}],"structuredContent":{"label":"NEGATIVE","score":-2}}}
```

With an invalid input the answer has `"isError": true`, and the validation message as its text.

**About security.** The MCP endpoint has no authentication unless you add one (`Total.mcp.auth`). In this tutorial the application listens only on `127.0.0.1` ([index.js](../../examples/tutorials/01-python-action-and-mcp/index.js)), so only your machine can reach it. Do the same, or put authentication in front of it, before you expose it anywhere. See [Security](../security.md).

This page calls the endpoint with `curl`. Pointing a specific AI client at it was not tried here.

## 6. Change the function while it runs

Open `python/sentiment.py` and add `'adore'` to `POSITIVE`. Do not restart anything. Ask for a text that uses it:

```bash
curl -s -X POST localhost:8000/api/ -H 'content-type: application/json' \
  -d '{"schema":"sentiment_analyze","data":{"text":"I adore it"}}'
```

Before the edit the answer is `{"label":"NEUTRAL","score":0}`; a moment after saving it is `{"label":"POSITIVE","score":1}`. The application printed:

```
[totalfusion] python: sentiment.py changed, replacing 1 worker
```

That is `watch: DEBUG`: the new worker starts first and the old one leaves when it is idle, so no request is lost while you edit.

## 7. Check the setup

```bash
npx totalfusion doctor --path python
```

```
TotalFusion doctor: python

[ok]    Interpreter  Python 3.15.0 (..., chosen by the default)
[warn]  Environment  This is a Python of the system, not a virtual environment: the libraries you install are shared with everything else
                     Fix: python3 -m venv .venv, install the libraries in it and set the venv option.
[ok]    Components   1 module in .../python, 1 action (0 streaming)
[ok]    Libraries    Everything the components import can be found

Everything is in order (1 warning)
```

It reads the code without running it and tells you what is missing and how to fix it. The warning is advice: for a real project, use a virtual environment.

## Check it yourself

With the application running, in another terminal:

```bash
npm run verify
```

[verify.js](../../examples/tutorials/01-python-action-and-mcp/verify.js) makes every call of this page and compares the answers. It is the same check that the tests of the project run.

## What you learned

- A function with `@action(...)` is a contract that Total.js turns into an action, an API and, if you say `mcp=True`, a tool for agents.
- Total.js validates the input before Python runs.
- The Python worker stays alive between calls, and you can edit it while the application runs.

## Next

- Use a library with a real model: [Python](../python.md).
- Send the output of a model as it is produced: [Streaming](../streaming.md).
- Put the function in a flow: [Flow](../flow.md).
- Every option of `register()`: [Total.js 5](../total5.md).
