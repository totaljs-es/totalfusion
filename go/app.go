package totalfusion

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"runtime/debug"
	"strings"
	"sync"
	"time"
)

// Version is the version of this module. It travels in the messages of the protocol and in --describe.
const Version = "0.1.0"

// Memory is the memory of this process in bytes, and false when the system does not allow to know it.
//
// Linux: resident set size. Windows: the private bytes of the process. Other systems (macOS): the memory that the Go runtime
// holds, which is what a worker written in Go uses.
func Memory() (uint64, bool) {
	return memory()
}

// FunctionHandler answers a call once.
type FunctionHandler func(call *Call) (any, error)

// StreamHandler sends many chunks with Call.Emit and returns when it is done.
type StreamHandler func(call *Call) error

type registered struct {
	name     string
	function FunctionHandler
	stream   StreamHandler
	meta     map[string]any
	// Registered as an action of Total.js: the function declared its contract or asked for it
	action bool
}

// App holds the functions of your worker. Create it with New, register the functions and call Run.
//
//	app := totalfusion.New()
//
//	app.Function("math.add", func(call *totalfusion.Call) (any, error) {
//		a, okA := call.Args.Get("a").AsFloat()
//		b, okB := call.Args.Get("b").AsFloat()
//		if !okA || !okB {
//			return nil, totalfusion.Invalid("a and b must be numbers")
//		}
//		return map[string]any{"sum": a + b}, nil
//	}).Summary("Adds two numbers").Input("*a:Number\n*b:Number").Output("sum:Number").MCP(true)
//
//	app.Run()
//
// The methods that describe a function (Summary, Input, Output, MCP, ...) apply to the function that was registered just before
// them. They are the contract that Total.js uses to create the action and the MCP tool.
type App struct {
	functions  []*registered
	onShutdown []func()
}

// New creates an App with no functions.
func New() *App {
	return &App{}
}

// Function registers a function that answers once. In JavaScript: fusion.go('name', args).
func (a *App) Function(name string, handler FunctionHandler) *App {
	a.functions = append(a.functions, &registered{name: name, function: handler, meta: map[string]any{}})
	return a
}

// Stream registers a function that sends many chunks with Call.Emit. In JavaScript: fusion.go.stream('name', args).
func (a *App) Stream(name string, handler StreamHandler) *App {
	a.functions = append(a.functions, &registered{name: name, stream: handler, meta: map[string]any{}})
	return a
}

// OnShutdown registers a function that runs when the worker is asked to stop, and when Node.js goes away.
func (a *App) OnShutdown(handler func()) *App {
	a.onShutdown = append(a.onShutdown, handler)
	return a
}

func (a *App) last() *registered {

	if len(a.functions) == 0 {
		panic("register a function before describing it")
	}

	return a.functions[len(a.functions)-1]
}

func (a *App) set(key string, value any) *App {
	function := a.last()
	function.meta[key] = value
	function.action = true
	return a
}

// Action registers the function as an action of Total.js (and a FlowStream or MCP tool, if it says so) even when it declares
// nothing else. A function that declares any part of its contract (Summary, Input, ...) is registered too; the ones that declare
// nothing can still be called from JavaScript, but they stay private.
func (a *App) Action() *App {
	a.last().action = true
	return a
}

// Summary is one line for people and for the MCP tool.
func (a *App) Summary(text string) *App {
	return a.set("summary", text)
}

// Input is the contract of the input, in the schema syntax of Total.js: "*name:String\nage:Number". * means required.
func (a *App) Input(schema string) *App {
	return a.set("input", schema)
}

func (a *App) Output(schema string) *App {
	return a.set("output", schema)
}

// Query declares the query string. With Query or Params declared, the function receives { input, query, params } instead of the input alone.
func (a *App) Query(schema string) *App {
	return a.set("query", schema)
}

func (a *App) Params(schema string) *App {
	return a.set("params", schema)
}

// MCP exposes the function to AI agents as an MCP tool. Off unless you say so.
func (a *App) MCP(value bool) *App {
	return a.set("mcp", value)
}

// Permissions says who may call: "admin,editor", any of them.
func (a *App) Permissions(permissions string) *App {
	return a.set("permissions", permissions)
}

// User allows only a logged in user (true) or only an anonymous one (false).
func (a *App) User(value bool) *App {
	return a.set("user", value)
}

func (a *App) SA(value bool) *App {
	return a.set("sa", value)
}

func (a *App) SU(value bool) *App {
	return a.set("su", value)
}

// Idempotent says that the function can be repeated with no harm: if its worker dies, Total.js repeats the call on another one (once).
func (a *App) Idempotent(value bool) *App {
	return a.set("idempotent", value)
}

// Timeout is the longest time of a call.
func (a *App) Timeout(duration time.Duration) *App {
	return a.set("timeout", duration.Milliseconds())
}

// ID is the name of the action in Total.js, if it should not be module/function.
func (a *App) ID(id string) *App {
	return a.set("id", id)
}

func (a *App) duplicates() []string {

	seen := map[string]bool{}
	var names []string

	for _, function := range a.functions {
		if seen[function.name] {
			names = append(names, function.name)
		}
		seen[function.name] = true
	}

	return names
}

// describe is the contracts, as fusion.describe('go') and register() read them.
func (a *App) describe() map[string]any {

	actions := []any{}
	problems := []any{}

	for _, name := range a.duplicates() {
		problems = append(problems, map[string]any{"module": "", "function": name, "message": "The function is registered more than once"})
	}

	for _, function := range a.functions {

		if !function.action {
			continue
		}

		module, name := "", function.name

		if index := strings.LastIndex(function.name, "."); index != -1 {
			module, name = function.name[:index], function.name[index+1:]
		}

		actions = append(actions, map[string]any{
			"fn":     function.name,
			"module": module,
			"name":   name,
			"async":  false,
			"stream": function.stream != nil,
			"doc":    nil,
			"meta":   function.meta,
		})
	}

	return map[string]any{"actions": actions, "functions": len(a.functions), "startups": []any{}, "errors": problems, "runtime": "go", "protocol": protocolVersion, "sdk": Version}
}

// Run starts the worker: it talks to Node.js through the standard input and output until Node.js closes them or asks it to stop.
// It never returns.
//
// With --describe it prints its contracts and exits. Anything you do before Run (loading a model, opening a connection) happens
// before the worker tells Node.js that it is ready.
func (a *App) Run() {

	for _, argument := range os.Args[1:] {
		if argument == "--describe" {
			data, err := marshal(a.describe())

			if err != nil {
				fmt.Fprintln(os.Stderr, "totalfusion:", err)
				os.Exit(1)
			}

			fmt.Println(string(data))
			os.Exit(0)
		}
	}

	if duplicates := a.duplicates(); len(duplicates) > 0 {
		fmt.Fprintf(os.Stderr, "totalfusion: the function \"%s\" is registered more than once\n", duplicates[0])
		os.Exit(1)
	}

	out := &writer{out: protocolOutput()}
	out.send(map[string]any{"t": "ready", "v": protocolVersion, "pid": os.Getpid(), "runtime": "go", "sdk": Version}, nil)

	calls := &running{items: map[int64]*Call{}}
	reader := bufio.NewReaderSize(os.Stdin, 1<<20)

loop:
	for {
		frame, parts, err := readFrame(reader)

		if err != nil {
			break
		}

		message, ok := frame.(map[string]any)

		if !ok {
			continue
		}

		switch message["t"] {
		case "call":
			name, _ := message["fn"].(string)
			stream, _ := message["stream"].(bool)
			a.start(out, calls, number(message["id"]), name, Value{decode(message["args"], parts)}, stream, number(message["credit"]))
		case "credit":
			if call := calls.get(number(message["id"])); call != nil {
				amount := number(message["n"])
				if message["n"] == nil {
					amount = 1
				}
				call.addCredit(amount)
			}
		case "cancel":
			if call := calls.get(number(message["id"])); call != nil {
				call.cancel()
			}
		case "ping":
			mem, known := memory()
			var reported any

			if known {
				reported = mem
			}

			out.send(map[string]any{"t": "pong", "id": message["id"], "mem": reported}, nil)
		case "bye":
			break loop
		}
	}

	// Node.js asked to stop, or it went away
	calls.cancelAll()

	for _, handler := range a.onShutdown {
		func() {
			defer func() { _ = recover() }()
			handler()
		}()
	}

	os.Exit(0)
}

// number reads an integer of a message; what is not a number is 0.
func number(value any) int64 {
	return Value{decode(value, nil)}.intOr(0)
}

func (v Value) intOr(fallback int64) int64 {
	if value, ok := v.AsInt(); ok {
		return value
	}
	return fallback
}

type running struct {
	mutex sync.Mutex
	items map[int64]*Call
}

func (r *running) get(id int64) *Call {
	r.mutex.Lock()
	defer r.mutex.Unlock()
	return r.items[id]
}

func (r *running) add(id int64, call *Call) {
	r.mutex.Lock()
	r.items[id] = call
	r.mutex.Unlock()
}

func (r *running) remove(id int64) {
	r.mutex.Lock()
	delete(r.items, id)
	r.mutex.Unlock()
}

func (r *running) cancelAll() {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	for _, call := range r.items {
		call.cancel()
	}
}

func (a *App) find(name string) *registered {
	for _, function := range a.functions {
		if function.name == name {
			return function
		}
	}
	return nil
}

func (a *App) start(out *writer, calls *running, id int64, name string, args Value, stream bool, credit int64) {

	function := a.find(name)

	if function == nil {
		finish(out, id, nil, notFound(fmt.Sprintf("Function \"%s\" not found", name)))
		return
	}

	if function.stream != nil && !stream {
		finish(out, id, nil, (&Error{Name: "TypeError", Message: fmt.Sprintf("The function \"%s\" is a stream: call it with fusion.stream()", name)}).WithCode("STREAMING_FUNCTION"))
		return
	}

	call := newCall(id, args, credit, out)
	calls.add(id, call)

	go func() {

		var result any
		var err error

		// A panic is a failure of this call, not of the worker
		func() {
			defer func() {
				if recovered := recover(); recovered != nil {
					fmt.Fprintf(os.Stderr, "totalfusion: panic in %s: %v\n%s", name, recovered, debug.Stack())
					err = Named("Panic", fmt.Sprint(recovered))
				}
			}()

			if function.stream != nil {
				err = function.stream(call)
				return
			}

			result, err = function.function(call)

			// A normal function called as a stream is a stream of one chunk
			if stream && err == nil {
				err = call.Emit(result)
				result = nil
			}
		}()

		calls.remove(id)
		call.cancel()
		finish(out, id, result, err)
	}()
}

func finish(out *writer, id int64, result any, failure error) {

	mem, known := memory()
	var reported any

	if known {
		reported = mem
	}

	if failure == nil {
		var parts [][]byte
		data, err := encode(result, &parts)

		if err == nil {
			out.send(map[string]any{"t": "res", "id": id, "ok": true, "data": data, "mem": reported}, parts)
			return
		}

		failure = err
	}

	problem := toError(failure)
	var code any

	if problem.Code != "" {
		code = problem.Code
	}

	out.send(map[string]any{"t": "res", "id": id, "ok": false, "error": map[string]any{"name": problem.Name, "message": problem.Message, "code": code}, "mem": reported}, nil)
}

type writer struct {
	mutex sync.Mutex
	out   io.Writer
}

func (w *writer) send(message any, parts [][]byte) {

	w.mutex.Lock()
	err := writeFrame(w.out, message, parts)
	w.mutex.Unlock()

	// If Node.js is gone nobody reads the answer: the worker is done
	if err != nil {
		os.Exit(0)
	}
}
