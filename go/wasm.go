package totalfusion

import (
	"errors"
	"fmt"
	"os"
	"runtime/debug"
)

// wasmApp is the app that the WebAssembly module exposes: the one that called Wasm in its init function.
var wasmApp *App

// Wasm makes this app the WebAssembly module. Build the program for WebAssembly with
//
//	GOOS=wasip1 GOARCH=wasm go build -buildmode=c-shared -o module.wasm
//
// and call Wasm from an init function (a reactor module does not run main):
//
//	func init() {
//		app := totalfusion.New()
//		app.Function("math.add", add).Input("*a:Number\n*b:Number").Output("sum:Number")
//		app.Wasm()
//	}
//
//	func main() {}
//
// The module exports the functions that TotalFusion calls (tf_abi, tf_alloc, tf_free, tf_describe and tf_call) when it is built for
// WebAssembly. It runs in a sandbox: it cannot read files, use the network or see the environment. A function answers once:
// a stream cannot be used, because a module has no way to send a chunk before it returns.
func (a *App) Wasm() *App {
	wasmApp = a
	return a
}

// wasmDescribe is what tf_describe returns: the contracts, as JSON.
func (a *App) wasmDescribe() []byte {

	data, err := marshal(a.describe())

	if err != nil {
		fmt.Fprintln(os.Stderr, "totalfusion:", err)
		return []byte(`{"actions":[],"errors":[]}`)
	}

	return data
}

// wasmResult is the body that tf_call returns: { ok, data } or { ok, error }, and the binary parts of the data.
func wasmResult(result any, failure error) []byte {

	if failure == nil {
		var parts [][]byte
		data, err := encode(result, &parts)

		if err == nil {
			if body, err := buildBody(map[string]any{"ok": true, "data": data}, parts); err == nil {
				return body
			}
		}

		failure = err
	}

	problem := toError(failure)
	var code any

	if problem.Code != "" {
		code = problem.Code
	}

	body, _ := buildBody(map[string]any{"ok": false, "error": map[string]any{"name": problem.Name, "message": problem.Message, "code": code}}, nil)
	return body
}

// wasmCall is what tf_call does: it runs the function name with the arguments of a body and returns the body of the answer.
func (a *App) wasmCall(name string, body []byte) (answer []byte) {

	message, parts, err := parseBody(body)

	if err != nil {
		return wasmResult(nil, Named("ProtocolError", err.Error()))
	}

	function := a.find(name)

	if function == nil {
		return wasmResult(nil, notFound(fmt.Sprintf("Function \"%s\" not found", name)))
	}

	if function.stream != nil {
		return wasmResult(nil, (&Error{Name: "TypeError", Message: fmt.Sprintf("The function \"%s\" is a stream, and a WebAssembly module cannot stream", name)}).WithCode("STREAMING_FUNCTION"))
	}

	call := newCall(0, Value{decode(message, parts)}, 0, nil)

	defer call.cancel()

	// A panic is a failure of this call, not of the module
	defer func() {
		if recovered := recover(); recovered != nil {
			fmt.Fprintf(os.Stderr, "totalfusion: panic in %s: %v\n%s", name, recovered, debug.Stack())
			answer = wasmResult(nil, Named("Panic", fmt.Sprint(recovered)))
		}
	}()

	result, err := function.function(call)
	return wasmResult(result, err)
}

var errNoWasmApp = errors.New("the module has no functions: call app.Wasm() in an init function")
