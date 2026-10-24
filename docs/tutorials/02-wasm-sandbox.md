# 2. Run the code of third parties in the sandbox of WebAssembly

You will build the core of a plugin system: each customer of your platform writes the rule that prices their orders, and your Total.js application **runs it without trusting it**. You will see a module that tries to read your files, see your environment, write to your disk and open a connection, and fail at every attempt. You will see another that never returns, and how the application cuts it off and goes on. It takes about fifteen minutes.

The finished application is in [examples/tutorials/02-wasm-sandbox](../../examples/tutorials/02-wasm-sandbox), and a test of the project builds the modules and runs it on every change.

## What you need

- Node.js 20 or newer, and the repository with `npm install` done in the folder of the tutorial.
- **Go 1.24 or newer, to build the modules.** Running them needs only Node.js: your customers could send you the `.wasm` file already built, from any language that makes WebAssembly. Only Go has an SDK in TotalFusion today.

```bash
cd examples/tutorials/02-wasm-sandbox
npm install
npm run build
npm start
```

`npm run build` makes `plugins/rules.wasm` and `plugins/hostile.wasm`. Each is about 5 MB, because the runtime of Go goes inside.

## 1. The rule of a customer

[rules/main.go](../../examples/tutorials/02-wasm-sandbox/rules/main.go) is what a customer writes. It is a Go program with a function that prices an order:

```go
func init() {

	app := totalfusion.New()

	app.Function("discount.apply", func(call *totalfusion.Call) (any, error) {

		price, okPrice := call.Args.Get("price").AsFloat()
		quantity, okQuantity := call.Args.Get("quantity").AsFloat()

		if !okPrice || !okQuantity || price < 0 || quantity < 1 {
			return nil, totalfusion.Invalid("price and quantity must be numbers, and the quantity at least 1")
		}

		// 10% from 10 units, 20% from 50, and 5% more for a premium customer
		...
		return map[string]any{"subtotal": subtotal, "discount": discount, "total": subtotal * (1 - discount)}, nil

	}).Summary("The price of an order, with the discount of this customer").Input("*price:Number\n*quantity:Number\ntier:String")

	app.Wasm() // this app is the module
}

func main() {}
```

A module of this kind does not run `main`, so the functions are registered in `init`, and `app.Wasm()` says that this app is the module. The contract (`Summary`, `Input`...) works as in [Go](../go.md).

## 2. Load the modules

[definitions/plugins.js](../../examples/tutorials/02-wasm-sandbox/definitions/plugins.js) keeps one `Fusion` for each module:

```js
const { Fusion } = REQUIRE('totalfusion');

const plugins = new Map();

function load(name) {
	plugins.set(name, new Fusion({ wasm: { module: PATH.root('plugins/' + name + '.wasm'), timeout: 1000, cancelGrace: 200 } }));
}
```

A runtime of TotalFusion has one module, so a platform with many customers has one `Fusion` for each one, and each module runs in a worker of its own: a customer cannot see the memory of another. `timeout: 1000` is the longest time that a call may take, and `cancelGrace` how long the module has to stop before it is killed.

Two routes use them. The first lists what each module offers, read **without running any function**; the second runs a function with the body of the request:

```js
ROUTE('GET /plugins/', list);
ROUTE('POST /plugins/{name}/{module}/{fn}/', run);   // /plugins/rules/discount/apply/ is the function discount.apply
```

(The function is split in the route because a dot in a route looks like a file to Total.js.)

```bash
curl -s localhost:8000/plugins/
```

```json
{"rules":[{"fn":"discount.apply","summary":"The price of an order, with the discount of this customer"}],"hostile":[{"fn":"steal.file","summary":"Tries to read a file of the machine"},{"fn":"steal.environment","summary":"Tries to read the environment of the process"},{"fn":"damage.write","summary":"Tries to write a file"},{"fn":"call.home","summary":"Tries to open a connection"},{"fn":"spin.forever","summary":"Never returns"}]}
```

## 3. Run the rule

```bash
curl -s -X POST localhost:8000/plugins/rules/discount/apply/ -H 'content-type: application/json' \
  -d '{"price":100,"quantity":60,"tier":"premium"}'
```

```json
{"discount":0.25,"subtotal":6000,"total":4500}
```

Sixty units get 20%, and a premium customer 5% more. With invalid input the function answers with its own error, and its name travels with it:

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST localhost:8000/plugins/rules/discount/apply/ \
  -H 'content-type: application/json' -d '{"price":100}'
```

```
[{"error":"REMOTE_ERROR: ValueError: price and quantity must be numbers, and the quantity at least 1"}]
HTTP 400
```

## 4. A module that tries to get out

[hostile/main.go](../../examples/tutorials/02-wasm-sandbox/hostile/main.go) is what a customer with bad intentions could send. Each of its functions does one thing that a sandbox does not allow. Try them:

```bash
# read a file of your machine
curl -s -X POST localhost:8000/plugins/hostile/steal/file/ -H 'content-type: application/json' -d '{"path":"/etc/hosts"}'
{"error":"open /etc/hosts: Invalid argument","read":false}

# read your environment (your keys and tokens are there)
curl -s -X POST localhost:8000/plugins/hostile/steal/environment/ -H 'content-type: application/json' -d '{}'
{"home":"","path":"","variables":0}

# write a file
curl -s -X POST localhost:8000/plugins/hostile/damage/write/ -H 'content-type: application/json' -d '{"path":"/tmp/escaped"}'
{"written":false}

# open a connection
curl -s -X POST localhost:8000/plugins/hostile/call/home/ -H 'content-type: application/json' -d '{}'
{"connected":false}
```

The file `/tmp/escaped` was not created. The module has **no files, no environment and no connections**: it is given none of them, and it can import nothing but WASI, so there is nothing to ask for. Its own code ran normally, and what it tried failed inside the module.

## 5. A module that never returns

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST localhost:8000/plugins/hostile/spin/forever/ -H 'content-type: application/json' -d '{}'
```

```
[{"error":"TIMEOUT: The call to wasm \"spin.forever\" timed out after 1000 ms"}]
HTTP 400
```

It answered after one second. The loop did not stop by itself: after the timeout and `cancelGrace` the worker was killed and replaced. The rest of the application did not notice, and neither did the other modules:

```bash
curl -s -X POST localhost:8000/plugins/rules/discount/apply/ -H 'content-type: application/json' -d '{"price":10,"quantity":10}'
{"discount":0.1,"subtotal":100,"total":90}

curl -s -X POST localhost:8000/plugins/hostile/steal/environment/ -H 'content-type: application/json' -d '{}'
{"home":"","path":"","variables":0}
```

The call to the hostile module right after the kill took a quarter of a second, the time to start its new worker. It is the same mechanism that restarts a Python worker that dies.

## 6. What the sandbox does not protect

Say this to yourself before you trust it with something real:

- **It is the sandbox of V8 and of WASI in Node.js, not a guarantee.** The process that runs the module has your permissions. If the engine had a flaw that lets a module escape, it would be as free as that process. For code you do not trust at all, add a container or a user without privileges. See [Security](../security.md).
- **Time and random numbers are available**, so a module is not deterministic.
- **Memory is not capped during one call.** `maxMemory` replaces the worker that went over after the call; a function that allocates without limit inside a call is stopped by the timeout, not by the memory.
- **A worker runs one call at a time**, so a customer with heavy traffic needs more `workers`.

## Check it yourself

With the application running, in another terminal:

```bash
npm run verify
```

[verify.js](../../examples/tutorials/02-wasm-sandbox/verify.js) makes every call of this page, including the four attempts to get out and the timeout, and compares the answers.

## What you learned

- A WebAssembly module runs in its own worker, with no files, no environment and no connections.
- You can load many, one `Fusion` for each, and read what they offer without running them.
- A function that does not return is cut off by the timeout, and the application goes on.

## Next

- Everything about the modules and their ABI: [WebAssembly](../webassembly.md).
- Report what happens to the workers: the [Events component of Flow](../flow.md#events).
- The options that keep workers healthy: [Working with the workers](../workers.md).
