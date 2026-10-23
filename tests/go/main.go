// The worker that the test suite of TotalFusion runs. It has a function for every situation that matters.
package main

import (
	"bytes"
	"fmt"
	"math"
	"os"
	"sync"
	"time"
	"unicode/utf8"

	totalfusion "github.com/totaljs-es/totalfusion/go"
)

var (
	hog      [][]byte
	hogMutex sync.Mutex
)

func number(call *totalfusion.Call, key string) (float64, error) {
	value, ok := call.Args.Get(key).AsFloat()

	if !ok {
		return 0, totalfusion.Invalidf("%s must be a number", key)
	}

	return value, nil
}

func wait(call *totalfusion.Call, key string) (time.Duration, error) {
	ms, err := number(call, key)
	return time.Duration(ms) * time.Millisecond, err
}

// each attempt leaves a byte in a file, even if the process dies
func attempt(call *totalfusion.Call) (int64, error) {

	path, ok := call.Args.Get("marker").AsString()

	if !ok {
		return 0, totalfusion.Invalid("marker must be a string")
	}

	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)

	if err != nil {
		return 0, err
	}

	_, err = file.Write([]byte("x"))
	_ = file.Close()

	if err != nil {
		return 0, err
	}

	info, err := os.Stat(path)

	if err != nil {
		return 0, err
	}

	return info.Size(), nil
}

func main() {

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
	}).Summary("Adds two numbers").Input("*a:Number\n*b:Number").Output("sum:Number").MCP(true).Timeout(5 * time.Second)

	app.Function("text.length", func(call *totalfusion.Call) (any, error) {
		text, ok := call.Args.Get("text").AsString()
		if !ok {
			return nil, totalfusion.Invalid("text must be a string")
		}
		return map[string]any{"length": utf8.RuneCountInString(text)}, nil
	}).Summary("Counts the characters").Input("*text:String").Output("length:Number")

	app.Function("echo", func(call *totalfusion.Call) (any, error) { return call.Args.Raw(), nil })
	app.Function("pid", func(call *totalfusion.Call) (any, error) { return os.Getpid(), nil })

	app.Function("exe", func(call *totalfusion.Call) (any, error) {
		path, _ := os.Executable()
		return path, nil
	})

	app.Function("memory", func(call *totalfusion.Call) (any, error) {
		if value, known := totalfusion.Memory(); known {
			return value, nil
		}
		return nil, nil
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
	app.Function("crash", func(call *totalfusion.Call) (any, error) { os.Exit(3); return nil, nil })
	app.Function("nan", func(call *totalfusion.Call) (any, error) { return math.NaN(), nil })

	app.Function("print", func(call *totalfusion.Call) (any, error) {
		fmt.Println("this goes to the error output, not to the protocol")
		return "ok", nil
	})

	// a function that checks if it was cancelled
	app.Function("sleep", func(call *totalfusion.Call) (any, error) {
		left, err := wait(call, "ms")
		if err != nil {
			return nil, err
		}

		for left > 0 {
			if call.Cancelled() {
				return nil, totalfusion.NewError("stopped")
			}
			time.Sleep(10 * time.Millisecond)
			left -= 10 * time.Millisecond
		}

		return "done", nil
	})

	// a function that never looks at Cancelled(): only killing the process stops it
	app.Function("deaf", func(call *totalfusion.Call) (any, error) {
		duration, err := wait(call, "ms")
		time.Sleep(duration)
		return "done", err
	})

	// keeps its worker busy, then says which worker it was
	app.Function("slow_pid", func(call *totalfusion.Call) (any, error) {
		duration, err := wait(call, "ms")
		time.Sleep(duration)
		return os.Getpid(), err
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

	app.Function("floats.sum", func(call *totalfusion.Call) (any, error) {
		values, ok := call.Args.Get("values").AsFloat32s()
		if !ok {
			return nil, totalfusion.Invalid("values must be a Float32Array")
		}
		var sum float64
		for _, item := range values {
			sum += float64(item)
		}
		return sum, nil
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
			"i32":    []int32{-1, 2},
			"f64":    []float64{0.5, 1.5},
			"u16":    []uint16{65535},
			"i64":    []int64{math.MinInt64},
			"bytes":  []byte{1, 2, 3},
			"nested": []any{[]byte{1}, []byte{2, 3}},
		}, nil
	})

	// query and params
	app.Function("sections", func(call *totalfusion.Call) (any, error) { return call.Args.Raw(), nil }).
		Summary("Shows what the worker receives").Input("a:Number").Query("*page:Number").Params("id:UID").MCP(true)

	app.Function("restricted", func(call *totalfusion.Call) (any, error) { return "allowed", nil }).Permissions("admin,editor")

	// memory
	app.Function("leak", func(call *totalfusion.Call) (any, error) {
		size, err := number(call, "mb")
		if err != nil {
			return nil, err
		}

		// touching every byte, otherwise the system does not give the memory
		block := bytes.Repeat([]byte{1}, int(size)*1024*1024)

		hogMutex.Lock()
		defer hogMutex.Unlock()
		hog = append(hog, block)
		return len(hog), nil
	})

	app.Function("held", func(call *totalfusion.Call) (any, error) {
		hogMutex.Lock()
		defer hogMutex.Unlock()
		return len(hog), nil
	})

	// streams
	app.Stream("count.up", func(call *totalfusion.Call) error {
		start, _ := call.Args.Get("start").AsInt()
		n, _ := call.Args.Get("n").AsInt()

		for index := int64(0); index < n; index++ {
			if err := call.Emit(start + index); err != nil {
				return err
			}
		}

		return nil
	}).Summary("Counts up")

	app.Stream("ticks", func(call *totalfusion.Call) error {
		n, err := number(call, "n")
		if err != nil {
			return err
		}

		delay, err := wait(call, "delay")
		if err != nil {
			return err
		}

		for index := 0; index < int(n); index++ {
			time.Sleep(delay)
			if err := call.Emit(map[string]any{"tick": index}); err != nil {
				return err
			}
		}

		return nil
	})

	app.Stream("blobs", func(call *totalfusion.Call) error {
		n, err := number(call, "n")
		if err != nil {
			return err
		}

		for index := 0; index < int(n); index++ {
			if err := call.Emit(map[string]any{"i": index, "blob": bytes.Repeat([]byte{byte(index)}, 1000)}); err != nil {
				return err
			}
		}

		return nil
	})

	app.Stream("fails_midway", func(call *totalfusion.Call) error {
		_ = call.Emit(1)
		_ = call.Emit(2)
		return totalfusion.Invalid("boom after two chunks")
	})

	app.Stream("crash_midway", func(call *totalfusion.Call) error {
		_ = call.Emit("first")
		os.Exit(3)
		return nil
	})

	app.Stream("endless", func(call *totalfusion.Call) error {
		// writes how far it got, so the test can see the backpressure
		file, _ := call.Args.Get("file").AsString()

		for index := 0; ; index++ {
			if file != "" {
				if os.WriteFile(file+".tmp", []byte(fmt.Sprint(index)), 0o644) == nil {
					_ = os.Rename(file+".tmp", file)
				}
			}

			if err := call.Emit(index); err != nil {
				return err
			}
		}
	})

	app.Function("actions.fails", func(call *totalfusion.Call) (any, error) {
		return nil, totalfusion.NewError("password of the database: secret")
	}).Action()

	app.Function("actions.rejects", func(call *totalfusion.Call) (any, error) {
		return nil, totalfusion.Invalid("the value is not acceptable")
	}).Action()

	app.Function("flaky.crash_first", func(call *totalfusion.Call) (any, error) {
		size, err := attempt(call)
		if err != nil {
			return nil, err
		}
		if size == 1 {
			os.Exit(3)
		}
		return "ok", nil
	})

	app.Function("flaky.crash_always", func(call *totalfusion.Call) (any, error) {
		if _, err := attempt(call); err != nil {
			return nil, err
		}
		os.Exit(3)
		return nil, nil
	})

	app.Function("flaky.counted", func(call *totalfusion.Call) (any, error) {
		path, _ := call.Args.Get("marker").AsString()
		info, err := os.Stat(path)
		if err != nil {
			return 0, nil
		}
		return info.Size(), nil
	})

	app.Function("single", func(call *totalfusion.Call) (any, error) { return "single", nil }).Action()

	app.OnShutdown(func() {
		if path := os.Getenv("FUSION_TEST_SHUTDOWN_FILE"); path != "" {
			_ = os.WriteFile(path, []byte("bye"), 0o644)
		}
	})

	app.Run()
}
