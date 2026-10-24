// A WebAssembly module for TotalFusion. Build it with
//
//	GOOS=wasip1 GOARCH=wasm go build -buildmode=c-shared -o module.wasm
package main

import (
	"unicode/utf8"

	totalfusion "github.com/totaljs-es/totalfusion/go"
)

// The number below limit with the longest Collatz chain, and the length of that chain.
func collatz(limit uint64) (uint64, int) {

	bestNumber, bestSteps := uint64(1), 1

	for start := uint64(1); start < limit; start++ {

		n, steps := start, 1

		for n != 1 {
			if n%2 == 0 {
				n /= 2
			} else {
				n = 3*n + 1
			}
			steps++
		}

		if steps > bestSteps {
			bestNumber, bestSteps = start, steps
		}
	}

	return bestNumber, bestSteps
}

// A reactor module does not run main: the functions are registered when the module starts.
func init() {

	app := totalfusion.New()

	app.Function("collatz.longest", func(call *totalfusion.Call) (any, error) {

		limit, ok := call.Args.Get("limit").AsInt()

		if !ok || limit <= 1 {
			return nil, totalfusion.Invalid("limit must be a number greater than 1")
		}

		number, steps := collatz(uint64(limit))
		return map[string]any{"number": number, "steps": steps}, nil

	}).
		Summary("Finds the number below the limit with the longest Collatz chain").
		Input("*limit:Number // Exclusive upper bound").
		Output("number:Number\nsteps:Number").
		MCP(true)

	app.Function("text.length", func(call *totalfusion.Call) (any, error) {

		text, ok := call.Args.Get("text").AsString()

		if !ok {
			return nil, totalfusion.Invalid("text must be a string")
		}

		return map[string]any{"length": utf8.RuneCountInString(text)}, nil

	}).Summary("Counts the characters of a text").Input("*text:String").Output("length:Number")

	app.Wasm()
}

func main() {}
