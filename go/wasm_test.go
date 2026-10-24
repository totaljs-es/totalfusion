package totalfusion

import (
	"encoding/json"
	"testing"
)

func wasmApplication() *App {

	app := New()

	app.Function("math.add", func(call *Call) (any, error) {
		a, okA := call.Args.Get("a").AsFloat()
		b, okB := call.Args.Get("b").AsFloat()

		if !okA || !okB {
			return nil, Invalid("a and b must be numbers")
		}

		return map[string]any{"sum": a + b}, nil
	}).Summary("Adds").Input("*a:Number\n*b:Number")

	app.Function("floats.double", func(call *Call) (any, error) {
		values, _ := call.Args.Get("values").AsFloat32s()
		doubled := make([]float32, len(values))

		for index, item := range values {
			doubled[index] = item * 2
		}

		return doubled, nil
	})

	app.Function("boom", func(call *Call) (any, error) { panic("kaboom") })
	app.Stream("count", func(call *Call) error { return nil })
	app.Function("emits", func(call *Call) (any, error) { return nil, call.Emit(1) })

	return app
}

// what the host sends: the arguments as the body of a frame
func bodyOf(t *testing.T, args any) []byte {

	t.Helper()

	var parts [][]byte
	data, err := encode(args, &parts)

	if err != nil {
		t.Fatal(err)
	}

	body, err := buildBody(data, parts)

	if err != nil {
		t.Fatal(err)
	}

	return body
}

// what the host reads: { ok, data | error } and its parts
func resultOf(t *testing.T, body []byte) Value {

	t.Helper()

	message, parts, err := parseBody(body)

	if err != nil {
		t.Fatal(err)
	}

	return Value{decode(message, parts)}
}

func TestAWasmCallAnswers(t *testing.T) {

	result := resultOf(t, wasmApplication().wasmCall("math.add", bodyOf(t, map[string]any{"a": 2, "b": 3.5})))

	if ok, _ := result.Get("ok").AsBool(); !ok {
		t.Fatalf("%v", result.Raw())
	}

	if sum, _ := result.Get("data").Get("sum").AsFloat(); sum != 5.5 {
		t.Errorf("%v", result.Raw())
	}
}

func TestBinaryDataGoesThroughAWasmCall(t *testing.T) {

	result := resultOf(t, wasmApplication().wasmCall("floats.double", bodyOf(t, map[string]any{"values": []float32{1.5, 2.5}})))
	values, ok := result.Get("data").AsFloat32s()

	if !ok || len(values) != 2 || values[0] != 3 || values[1] != 5 {
		t.Errorf("%v", result.Raw())
	}
}

func TestAWasmCallFailsWithTheNameOfTheError(t *testing.T) {

	app := wasmApplication()

	for name, expected := range map[string][2]string{
		"math.add": {"ValueError", ""},
		"nope":     {"LookupError", "NOT_FOUND"},
		"count":    {"TypeError", "STREAMING_FUNCTION"},
		"boom":     {"Panic", ""},
		"emits":    {"TypeError", ""},
	} {
		args := map[string]any{"a": 1}
		result := resultOf(t, app.wasmCall(name, bodyOf(t, args)))

		if ok, _ := result.Get("ok").AsBool(); ok {
			t.Errorf("%s did not fail", name)
		}

		failure := result.Get("error")

		if got, _ := failure.Get("name").AsString(); got != expected[0] {
			t.Errorf("%s: name %v", name, failure.Raw())
		}

		if code, _ := failure.Get("code").AsString(); code != expected[1] {
			t.Errorf("%s: code %v", name, failure.Raw())
		}
	}
}

func TestABodyThatIsNotOneIsAnError(t *testing.T) {

	result := resultOf(t, wasmApplication().wasmCall("math.add", []byte{1, 2, 3}))

	if ok, _ := result.Get("ok").AsBool(); ok {
		t.Error("it did not fail")
	}
}

func TestTheContractsOfAModule(t *testing.T) {

	var described struct {
		Actions []struct {
			Fn     string         `json:"fn"`
			Stream bool           `json:"stream"`
			Meta   map[string]any `json:"meta"`
		} `json:"actions"`
		Functions int `json:"functions"`
	}

	if err := json.Unmarshal(wasmApplication().wasmDescribe(), &described); err != nil {
		t.Fatal(err)
	}

	// only the function that declares a contract is an action; the others are private but counted
	if len(described.Actions) != 1 || described.Actions[0].Fn != "math.add" || described.Functions != 5 {
		t.Errorf("%+v", described)
	}

	if described.Actions[0].Meta["input"] != "*a:Number\n*b:Number" {
		t.Errorf("%v", described.Actions[0].Meta)
	}
}

func TestWasmRegistersTheApp(t *testing.T) {

	app := New()
	previous := wasmApp

	defer func() { wasmApp = previous }()

	if app.Wasm() != app || wasmApp != app {
		t.Error("the app was not registered")
	}
}
