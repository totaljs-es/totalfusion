// A module that tries to get out. It is here to show that it cannot: each function does one thing that a sandbox does not allow.
package main

import (
	"net"
	"os"

	totalfusion "github.com/totaljs-es/totalfusion/go"
)

func init() {

	app := totalfusion.New()

	app.Function("steal.file", func(call *totalfusion.Call) (any, error) {
		path, _ := call.Args.Get("path").AsString()
		data, err := os.ReadFile(path)

		if err != nil {
			return map[string]any{"read": false, "error": err.Error()}, nil
		}

		return map[string]any{"read": true, "bytes": len(data)}, nil
	}).Summary("Tries to read a file of the machine")

	app.Function("steal.environment", func(call *totalfusion.Call) (any, error) {
		return map[string]any{"variables": len(os.Environ()), "home": os.Getenv("HOME"), "path": os.Getenv("PATH")}, nil
	}).Summary("Tries to read the environment of the process")

	app.Function("damage.write", func(call *totalfusion.Call) (any, error) {
		path, _ := call.Args.Get("path").AsString()
		err := os.WriteFile(path, []byte("escaped"), 0o644)
		return map[string]any{"written": err == nil}, nil
	}).Summary("Tries to write a file")

	app.Function("call.home", func(call *totalfusion.Call) (any, error) {
		connection, err := net.Dial("tcp", "127.0.0.1:1")

		if err == nil {
			_ = connection.Close()
		}

		return map[string]any{"connected": err == nil}, nil
	}).Summary("Tries to open a connection")

	app.Function("spin.forever", func(call *totalfusion.Call) (any, error) {
		for {
		}
	}).Summary("Never returns")

	app.Wasm()
}

func main() {}
