# Getting started

## 1. Install

TotalFusion is **not on npm yet**. From a clone of the repository, install it by its path:

```bash
npm install ../totalfusion          # or "totalfusion": "file:../totalfusion" in your package.json
```

Once it is published it will be `npm install totalfusion`. You need Node.js 20 or newer, and Python 3.9 or newer for the Python runtime. Rust is needed only to **build** a Rust worker, never to run one.

## 2. Your first function, in any Node.js program

```python
# python/hello.py
def greet(data):
    return {'message': 'Hello ' + data['name']}
```

```js
// app.js
const fusion = require('totalfusion');

fusion.configure({ python: { path: './python' } });

fusion.python('hello.greet', { name: 'world' }).then(result => {
    console.log(result);            // { message: 'Hello world' }
    return fusion.shutdown();
});
```

A pool of Python processes starts on the first call and stays alive. [examples/basic.js](../examples/basic.js) is a version of this that you can run.

## 3. In a Total.js 5 application

Declare what the function takes and returns, and it becomes an **action** of Total.js:

```python
# python/hello.py
from totalfusion import action

@action(summary='Greets someone', input='*name:String', output='message:String')
def greet(data):
    return {'message': 'Hello ' + data['name']}
```

```js
// definitions/fusion.js
const fusion = REQUIRE('totalfusion');

exports.install = function() {
    fusion.register({ python: { path: PATH.root('python') }, watch: DEBUG });
    ROUTE('API  /api/  +hello_greet  -->  hello/greet');
};
```

Now `ACTION('hello/greet', { name: 'x' })` and `POST /api/` work, Total.js rejects an input without `name` before Python runs, and with `watch: DEBUG` the next request uses your edits. The whole application is in [examples/totaljs-app](../examples/totaljs-app). More in [Total.js 5](total5.md).

## 4. Rust

If a function is heavy on the CPU, write it in Rust, build a binary and call it the same way:

```js
fusion.configure({ rust: { binary: './worker/target/release/worker' } });
await fusion.rust('collatz.longest', { limit: 3000000 });
```

See [Rust](rust.md) and [examples/rust.js](../examples/rust.js).

## 5. Check your setup

```bash
npx totalfusion doctor --path ./python
```

It tells you which libraries are missing and the exact command to install them in the right Python. Nothing is imported, run or installed. See [Development and diagnosis](development.md).

## Where to go next

| If you want to... | Read |
|---|---|
| use machine learning or any Python library | [Python](python.md) |
| run heavy work without blocking Node.js | [Rust](rust.md) |
| expose functions as actions, API routes, MCP tools | [Total.js 5](total5.md) |
| send images, audio or arrays | [Binary data](binary-data.md) |
| show a model's output as it is produced | [Streaming](streaming.md) |
| call many slow things at the same time | [Working with the workers](workers.md#several-calls-at-the-same-time) |
| see ideas with real numbers | [Use cases](use-cases.md) |
| know what a setting does | [Reference](reference.md) |
