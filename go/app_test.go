package totalfusion

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func num(text string) any {
	return json.Number(text)
}

func frameOf(t *testing.T, data []byte, parts [][]byte) []byte {

	t.Helper()

	size := 4 + len(data) + 4 + len(parts)*4

	for _, part := range parts {
		size += len(part)
	}

	frame := binary.BigEndian.AppendUint32(nil, uint32(size))
	frame = binary.BigEndian.AppendUint32(frame, uint32(len(data)))
	frame = append(frame, data...)
	frame = binary.BigEndian.AppendUint32(frame, uint32(len(parts)))

	for _, part := range parts {
		frame = binary.BigEndian.AppendUint32(frame, uint32(len(part)))
	}

	for _, part := range parts {
		frame = append(frame, part...)
	}

	return frame
}

// what the worker wrote, frame by frame
func written(t *testing.T, buffer *bytes.Buffer) []map[string]any {

	t.Helper()

	var messages []map[string]any
	source := bufio.NewReader(bytes.NewReader(buffer.Bytes()))

	for {
		message, _, err := readFrame(source)

		if err != nil {
			return messages
		}

		messages = append(messages, message.(map[string]any))
	}
}

func TestTheContractsAreDescribedLikeTheOtherWorkersDo(t *testing.T) {

	nothing := func(*Call) (any, error) { return nil, nil }

	app := New().
		Function("math.add", nothing).Summary("Adds").Input("*a:Number").MCP(true).Timeout(5*time.Second).
		Stream("count.up", func(*Call) error { return nil }).Action().
		Function("ping", nothing).Action().
		Function("internal.helper", nothing)

	described := app.describe()
	actions := described["actions"].([]any)

	// the one that declares nothing stays private, but it is counted
	if len(actions) != 3 || described["functions"] != 4 {
		t.Fatalf("%d actions, %v functions", len(actions), described["functions"])
	}

	first := actions[0].(map[string]any)
	meta := first["meta"].(map[string]any)

	if first["fn"] != "math.add" || first["module"] != "math" || first["name"] != "add" || first["stream"] != false {
		t.Errorf("%v", first)
	}

	if meta["summary"] != "Adds" || meta["input"] != "*a:Number" || meta["mcp"] != true || meta["timeout"] != int64(5000) {
		t.Errorf("%v", meta)
	}

	if actions[1].(map[string]any)["stream"] != true {
		t.Error("stream")
	}

	last := actions[2].(map[string]any)

	if last["module"] != "" || last["name"] != "ping" || described["protocol"] != 2 || described["runtime"] != "go" {
		t.Errorf("%v %v", last, described)
	}
}

func TestDeclaringAnyPartOfTheContractRegistersTheFunction(t *testing.T) {

	nothing := func(*Call) (any, error) { return nil, nil }
	app := New().Function("a", nothing).MCP(false).Function("b", nothing).Function("c", nothing).Action()

	var names []string

	for _, action := range app.describe()["actions"].([]any) {
		names = append(names, action.(map[string]any)["fn"].(string))
	}

	if strings.Join(names, ",") != "a,c" {
		t.Errorf("%v", names)
	}
}

func TestAFunctionRegisteredTwiceIsReported(t *testing.T) {

	nothing := func(*Call) (any, error) { return nil, nil }
	app := New().Function("a", nothing).Function("a", nothing)

	if len(app.duplicates()) != 1 || len(app.describe()["errors"].([]any)) != 1 {
		t.Error("not reported")
	}
}

func TestDescribingWithoutAFunctionIsAMistake(t *testing.T) {

	defer func() {
		if recover() == nil {
			t.Error("it did not panic")
		}
	}()

	New().Summary("nothing to describe")
}

func TestAnErrorKeepsItsNameAndCodeEvenWrapped(t *testing.T) {

	wrapped := errors.Join(errors.New("context"), Named("DatabaseError", "no connection").WithCode("E_DB"))
	problem := toError(wrapped)

	if problem.Name != "DatabaseError" || problem.Code != "E_DB" {
		t.Errorf("%+v", problem)
	}

	if plain := toError(errors.New("boom")); plain.Name != "Error" || plain.Message != "boom" {
		t.Errorf("%+v", plain)
	}

	if Invalid("x").Name != "ValueError" || !IsCancelled(ErrCancelled) || IsCancelled(errors.New("x")) {
		t.Error("kinds")
	}
}

func TestAFailureIsAnswered(t *testing.T) {

	var buffer bytes.Buffer
	out := &writer{out: &buffer}

	finish(out, 4, nil, Invalid("the value is not acceptable"))
	finish(out, 5, map[string]any{"ok": true}, nil)
	finish(out, 6, nil, errors.New("plain"))
	finish(out, 7, func() {}, nil)

	messages := written(t, &buffer)

	if len(messages) != 4 {
		t.Fatalf("%d messages", len(messages))
	}

	failure := messages[0]["error"].(map[string]any)

	if messages[0]["ok"] != false || failure["name"] != "ValueError" || failure["code"] != nil {
		t.Errorf("%v", messages[0])
	}

	if messages[1]["ok"] != true {
		t.Errorf("%v", messages[1])
	}

	if messages[2]["error"].(map[string]any)["name"] != "Error" {
		t.Errorf("%v", messages[2])
	}

	if messages[3]["error"].(map[string]any)["code"] != "NOT_SERIALIZABLE" {
		t.Errorf("%v", messages[3])
	}
}

func TestAStreamWaitsForCreditAndStopsWhenCancelled(t *testing.T) {

	var buffer bytes.Buffer
	call := newCall(9, Value{}, 2, &writer{out: &buffer})

	// two credits: two chunks go at once
	if err := call.Emit(1); err != nil {
		t.Fatal(err)
	}

	if err := call.Emit(2); err != nil {
		t.Fatal(err)
	}

	result := make(chan error, 1)
	go func() { result <- call.Emit(3) }()

	select {
	case <-result:
		t.Fatal("the third chunk went without credit")
	case <-time.After(100 * time.Millisecond):
	}

	call.addCredit(1)

	if err := <-result; err != nil {
		t.Fatal(err)
	}

	// the consumer gave up: what waits is released
	go func() { result <- call.Emit(4) }()
	time.Sleep(50 * time.Millisecond)
	call.cancel()

	if err := <-result; !IsCancelled(err) || !call.Cancelled() {
		t.Fatalf("%v", err)
	}

	if len(written(t, &buffer)) != 3 {
		t.Errorf("%d chunks", len(written(t, &buffer)))
	}
}

func TestSeveralEmittersAreAllReleasedByOneCredit(t *testing.T) {

	var buffer bytes.Buffer
	call := newCall(1, Value{}, 0, &writer{out: &buffer})
	done := make(chan error, 3)

	for index := 0; index < 3; index++ {
		go func(index int) { done <- call.Emit(index) }(index)
	}

	time.Sleep(50 * time.Millisecond)
	call.addCredit(3)

	for index := 0; index < 3; index++ {
		select {
		case err := <-done:
			if err != nil {
				t.Fatal(err)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("an emitter was not released")
		}
	}
}

func TestTheMemoryIsKnown(t *testing.T) {
	if value, known := Memory(); !known || value < 100*1024 {
		t.Errorf("%d %v", value, known)
	}
}
