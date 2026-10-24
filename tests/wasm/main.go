// The WebAssembly module that the test suite of TotalFusion runs. Build it with
//
//	GOOS=wasip1 GOARCH=wasm go build -buildmode=c-shared -o module.wasm
package main

import (
	"bytes"
	"fmt"
	"math"
	"net"
	"os"
	"unicode/utf8"

	totalfusion "github.com/totaljs-es/totalfusion/go"
)

var (
	counter int
	hog     [][]byte
)

func number(call *totalfusion.Call, key string) (float64, error) {
	value, ok := call.Args.Get(key).AsFloat()

	if !ok {
		return 0, totalfusion.Invalidf("%s must be a number", key)
	}

	return value, nil
}

func init() {

	app := totalfusion.New()

	app.Function("math.add", func(call *totalfusion.Call) (any, error) {
		a, err := number(call, "a")
		if err != nil {
			return nil, err
		}
		b, err := number(call, "b")
		if err != nil {
			return nil, err
		}
		return map[string]any{"sum": a + b}, nil
	}).Summary("Adds two numbers").Input("*a:Number\n*b:Number").Output("sum:Number").MCP(true)

	app.Function("text.length", func(call *totalfusion.Call) (any, error) {
		text, ok := call.Args.Get("text").AsString()
		if !ok {
			return nil, totalfusion.Invalid("text must be a string")
		}
		return map[string]any{"length": utf8.RuneCountInString(text)}, nil
	}).Summary("Counts the characters").Input("*text:String").Output("length:Number")

	app.Function("echo", func(call *totalfusion.Call) (any, error) { return call.Args.Raw(), nil })
	app.Function("single", func(call *totalfusion.Call) (any, error) { return "single", nil }).Action()

	// state: it lives as long as the instance
	app.Function("counter.next", func(call *totalfusion.Call) (any, error) {
		counter++
		return counter, nil
	})

	// failures
	app.Function("fail", func(call *totalfusion.Call) (any, error) { return nil, totalfusion.NewError("something failed") })
	app.Function("invalid", func(call *totalfusion.Call) (any, error) {
		return nil, totalfusion.Invalid("the value is not acceptable")
	})
	app.Function("named", func(call *totalfusion.Call) (any, error) {
		return nil, totalfusion.Named("DatabaseError", "no connection").WithCode("E_DB")
	})
	app.Function("boom", func(call *totalfusion.Call) (any, error) { panic("kaboom") })
	app.Function("nan", func(call *totalfusion.Call) (any, error) { return math.NaN(), nil })
	app.Function("exit", func(call *totalfusion.Call) (any, error) { os.Exit(3); return nil, nil })

	// a function that never returns
	app.Function("spin", func(call *totalfusion.Call) (any, error) {
		for {
		}
	})

	app.Function("print", func(call *totalfusion.Call) (any, error) {
		fmt.Println("this goes to the error output, not to the protocol")
		return "ok", nil
	})

	// binary data
	app.Function("bytes.length", func(call *totalfusion.Call) (any, error) {
		blob, ok := call.Args.Get("blob").AsBytes()
		if !ok {
			return nil, totalfusion.Invalid("blob must be a Buffer")
		}
		return len(blob), nil
	})

	app.Function("bytes.sum", func(call *totalfusion.Call) (any, error) {
		blob, ok := call.Args.Get("blob").AsBytes()
		if !ok {
			return nil, totalfusion.Invalid("blob must be a Buffer")
		}
		var sum uint64
		for _, item := range blob {
			sum += uint64(item)
		}
		return sum, nil
	})

	app.Function("bytes.make", func(call *totalfusion.Call) (any, error) {
		size, err := number(call, "n")
		return bytes.Repeat([]byte{7}, int(size)), err
	})

	app.Function("floats.double", func(call *totalfusion.Call) (any, error) {
		values, ok := call.Args.Get("values").AsFloat32s()
		if !ok {
			return nil, totalfusion.Invalid("values must be a Float32Array")
		}
		doubled := make([]float32, len(values))
		for index, item := range values {
			doubled[index] = item * 2
		}
		return doubled, nil
	})

	app.Function("types", func(call *totalfusion.Call) (any, error) {
		return map[string]any{
			"i32":   []int32{-1, 2},
			"f64":   []float64{0.5, 1.5},
			"u16":   []uint16{65535},
			"i64":   []int64{math.MinInt64},
			"bytes": []byte{1, 2, 3},
		}, nil
	})

	// what a sandbox does not allow
	app.Function("sandbox.read", func(call *totalfusion.Call) (any, error) {
		path, _ := call.Args.Get("path").AsString()
		data, err := os.ReadFile(path)
		if err != nil {
			return map[string]any{"read": false, "error": err.Error()}, nil
		}
		return map[string]any{"read": true, "size": len(data)}, nil
	})

	app.Function("sandbox.write", func(call *totalfusion.Call) (any, error) {
		path, _ := call.Args.Get("path").AsString()
		err := os.WriteFile(path, []byte("escaped"), 0o644)
		return map[string]any{"written": err == nil}, nil
	})

	app.Function("sandbox.env", func(call *totalfusion.Call) (any, error) {
		return map[string]any{"variables": len(os.Environ()), "home": os.Getenv("HOME"), "args": len(os.Args)}, nil
	})

	app.Function("sandbox.net", func(call *totalfusion.Call) (any, error) {
		connection, err := net.Dial("tcp", "127.0.0.1:1")
		if err == nil {
			_ = connection.Close()
		}
		return map[string]any{"connected": err == nil}, nil
	})

	// memory
	app.Function("hold", func(call *totalfusion.Call) (any, error) {
		size, err := number(call, "mb")
		if err != nil {
			return nil, err
		}
		hog = append(hog, bytes.Repeat([]byte{1}, int(size)*1024*1024))
		return len(hog), nil
	})

	app.Function("held", func(call *totalfusion.Call) (any, error) { return len(hog), nil })

	app.Stream("count.up", func(call *totalfusion.Call) error { return call.Emit(1) })

	app.Wasm()
}

func main() {}
