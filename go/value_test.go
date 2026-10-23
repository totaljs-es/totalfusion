package totalfusion

import (
	"math"
	"reflect"
	"testing"
)

// what a function returns, as Node.js would send it back as an argument
func roundTrip(t *testing.T, value any) Value {

	t.Helper()

	var parts [][]byte
	data, err := encode(value, &parts)

	if err != nil {
		t.Fatal(err)
	}

	// through the JSON, like the real trip
	text, err := marshal(data)

	if err != nil {
		t.Fatal(err)
	}

	message, framed, err := readFrame(reader(frameOf(t, text, parts)))

	if err != nil {
		t.Fatal(err)
	}

	return Value{decode(message, framed)}
}

func TestJSONValuesSurvive(t *testing.T) {

	value := roundTrip(t, map[string]any{"a": 1, "b": "text", "c": 2.5, "d": true, "e": nil, "f": []any{1, 2, 3}})

	if n, _ := value.Get("a").AsInt(); n != 1 {
		t.Error("a")
	}

	if s, _ := value.Get("b").AsString(); s != "text" {
		t.Error("b")
	}

	if f, _ := value.Get("c").AsFloat(); f != 2.5 {
		t.Error("c")
	}

	if b, _ := value.Get("d").AsBool(); !b {
		t.Error("d")
	}

	if !value.Get("e").IsNull() || !value.Get("missing").IsNull() || !value.Get("f").At(9).IsNull() {
		t.Error("null")
	}

	if n, _ := value.Get("f").At(2).AsInt(); n != 3 {
		t.Error("f")
	}
}

func TestEveryTypedArraySurvives(t *testing.T) {

	original := map[string]any{
		"bytes": []byte{1, 2, 3},
		"i8":    []int8{-1, 2},
		"i16":   []int16{-300, 300},
		"u16":   []uint16{65535},
		"i32":   []int32{-1, 2},
		"u32":   []uint32{4000000000},
		"i64":   []int64{math.MinInt64, 1},
		"u64":   []uint64{math.MaxUint64},
		"f32":   []float32{1.5, -2.5},
		"f64":   []float64{0.1, 0.2},
		"empty": []float32{},
	}

	got := roundTrip(t, original).Raw().(map[string]any)

	for key, expected := range original {
		if !reflect.DeepEqual(got[key], expected) {
			t.Errorf("%s: %v != %v", key, got[key], expected)
		}
	}
}

func TestBinaryDataIsNotInTheJSON(t *testing.T) {

	var parts [][]byte
	data, err := encode(map[string]any{"a": []float32{1, 2}, "b": []any{[]byte{1}}}, &parts)

	if err != nil || len(parts) != 2 {
		t.Fatalf("%v %d", err, len(parts))
	}

	text, _ := marshal(data)

	if len(text) > 120 {
		t.Errorf("the JSON carries the data: %s", text)
	}
}

func TestIntegersAndFloatsAreTold(t *testing.T) {

	value := roundTrip(t, map[string]any{"i": 3, "f": 3.0, "big": uint64(math.MaxUint64), "half": 0.5})

	if n, ok := value.Get("i").AsInt(); !ok || n != 3 {
		t.Error("i")
	}

	// 3.0 is written as 3 by JSON, and a number with no decimals reads as an integer
	if n, ok := value.Get("f").AsInt(); !ok || n != 3 {
		t.Error("f")
	}

	if _, ok := value.Get("half").AsInt(); ok {
		t.Error("0.5 is not an integer")
	}

	if f, _ := value.Get("big").AsFloat(); f != float64(math.MaxUint64) {
		t.Error("big")
	}
}

func TestOtherTypesGoThroughJSON(t *testing.T) {

	type host struct {
		Name string `json:"name"`
		Port int    `json:"port"`
	}

	value := roundTrip(t, map[string]any{"host": host{"a", 80}, "names": []string{"x", "y"}, "pointer": (*host)(nil), "counts": map[string]int{"n": 2}})

	if s, _ := value.Get("host").Get("name").AsString(); s != "a" {
		t.Error("struct")
	}

	if s, _ := value.Get("names").At(1).AsString(); s != "y" {
		t.Error("slice")
	}

	if !value.Get("pointer").IsNull() {
		t.Error("nil pointer")
	}

	if n, _ := value.Get("counts").Get("n").AsInt(); n != 2 {
		t.Error("map")
	}
}

func TestNaNAndInfinityCannotBeSent(t *testing.T) {

	for _, value := range []any{math.NaN(), math.Inf(1), float32(math.NaN()), map[string]any{"a": []any{math.Inf(-1)}}} {
		var parts [][]byte

		if _, err := encode(value, &parts); err == nil || toError(err).Code != "NOT_SERIALIZABLE" {
			t.Errorf("%v was accepted", value)
		}
	}
}

func TestAValueThatIsNotJSONCannotBeSent(t *testing.T) {

	var parts [][]byte

	if _, err := encode(func() {}, &parts); err == nil || toError(err).Code != "NOT_SERIALIZABLE" {
		t.Error("a function was accepted")
	}
}

func TestAnObjectThatLooksLikeAReferenceButIsNotOne(t *testing.T) {

	// two keys, but the type is not one of the arrays: it stays an object
	value := Value{decode(map[string]any{"$bin": num("0"), "type": "Nope"}, [][]byte{{1}})}
	object, ok := value.AsObject()

	if !ok || len(object) != 2 {
		t.Errorf("%v", value.Raw())
	}

	// and a reference to a part that does not exist
	value = Value{decode(map[string]any{"$bin": num("5"), "type": "Uint8Array"}, [][]byte{{1}})}

	if _, ok := value.AsObject(); !ok {
		t.Error("a missing part")
	}

	// a part with a length that does not fit the type
	value = Value{decode(map[string]any{"$bin": num("0"), "type": "Float32Array"}, [][]byte{{1, 2, 3}})}

	if _, ok := value.AsObject(); !ok {
		t.Error("a part that does not fit")
	}
}

func TestReadingNeverPanics(t *testing.T) {

	value := Value{}

	if !value.Get("a").Get("b").At(3).IsNull() {
		t.Error("null")
	}

	if _, ok := (Value{"text"}).AsFloat(); ok {
		t.Error("a string is not a number")
	}

	if _, ok := (Value{int64(1)}).AsString(); ok {
		t.Error("a number is not a string")
	}

	if _, ok := (Value{int64(1)}).At(0).AsInt(); ok {
		t.Error("a number has no items")
	}
}
