package totalfusion

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"math"
	"reflect"
)

// Value is what a function receives from Node.js: everything JSON can hold, plus binary data. Reading it never panics:
// a key that is not there, or a value of another type, is simply null (IsNull) or false in the As methods.
//
// Buffer and Uint8Array are []byte. The other typed arrays of JavaScript (Float32Array, Int32Array, ...) are the slices of the
// matching type ([]float32, []int32, ...) and travel as raw bytes, without going through JSON.
type Value struct {
	raw any
}

// Raw is the value as plain Go: nil, bool, int64, float64, string, []any, map[string]any, []byte or a slice of numbers.
func (v Value) Raw() any {
	return v.raw
}

func (v Value) IsNull() bool {
	return v.raw == nil
}

// Get is the member key of an object.
func (v Value) Get(key string) Value {
	if object, ok := v.raw.(map[string]any); ok {
		return Value{object[key]}
	}
	return Value{}
}

// At is the item index of an array.
func (v Value) At(index int) Value {
	if items, ok := v.raw.([]any); ok && index >= 0 && index < len(items) {
		return Value{items[index]}
	}
	return Value{}
}

func (v Value) AsBool() (bool, bool) {
	value, ok := v.raw.(bool)
	return value, ok
}

func (v Value) AsString() (string, bool) {
	value, ok := v.raw.(string)
	return value, ok
}

// AsFloat is any number, as a float.
func (v Value) AsFloat() (float64, bool) {
	switch value := v.raw.(type) {
	case int64:
		return float64(value), true
	case float64:
		return value, true
	}
	return 0, false
}

// AsInt is an integer, or a float that has no decimals.
func (v Value) AsInt() (int64, bool) {
	switch value := v.raw.(type) {
	case int64:
		return value, true
	case float64:
		if value == math.Trunc(value) && math.Abs(value) < 9.0e15 {
			return int64(value), true
		}
	}
	return 0, false
}

// AsBytes is the content of a Buffer or a Uint8Array.
func (v Value) AsBytes() ([]byte, bool) {
	value, ok := v.raw.([]byte)
	return value, ok
}

func (v Value) AsFloat32s() ([]float32, bool) {
	value, ok := v.raw.([]float32)
	return value, ok
}

func (v Value) AsFloat64s() ([]float64, bool) {
	value, ok := v.raw.([]float64)
	return value, ok
}

func (v Value) AsInt32s() ([]int32, bool) {
	value, ok := v.raw.([]int32)
	return value, ok
}

func (v Value) AsArray() ([]Value, bool) {

	items, ok := v.raw.([]any)

	if !ok {
		return nil, false
	}

	output := make([]Value, len(items))

	for index, item := range items {
		output[index] = Value{item}
	}

	return output, true
}

func (v Value) AsObject() (map[string]Value, bool) {

	object, ok := v.raw.(map[string]any)

	if !ok {
		return nil, false
	}

	output := make(map[string]Value, len(object))

	for key, item := range object {
		output[key] = Value{item}
	}

	return output, true
}

// ---------------------------------------------------------------------------------------------
// The wire format. Binary data is not in the JSON: it is replaced by { "$bin": index, "type": "Float32Array" }
// and travels raw after the JSON (see wire.go).
// ---------------------------------------------------------------------------------------------

func unpack[T any](bytes []byte, size int, read func([]byte) T) ([]T, bool) {

	if len(bytes)%size != 0 {
		return nil, false
	}

	items := make([]T, len(bytes)/size)

	for index := range items {
		items[index] = read(bytes[index*size:])
	}

	return items, true
}

func typed(kind string, data []byte) (any, bool) {

	order := binary.LittleEndian

	switch kind {
	case "Uint8Array":
		return data, true
	case "Int8Array":
		items := make([]int8, len(data))
		for index, item := range data {
			items[index] = int8(item)
		}
		return items, true
	case "Int16Array":
		return unpack(data, 2, func(b []byte) int16 { return int16(order.Uint16(b)) })
	case "Uint16Array":
		return unpack(data, 2, order.Uint16)
	case "Int32Array":
		return unpack(data, 4, func(b []byte) int32 { return int32(order.Uint32(b)) })
	case "Uint32Array":
		return unpack(data, 4, order.Uint32)
	case "BigInt64Array":
		return unpack(data, 8, func(b []byte) int64 { return int64(order.Uint64(b)) })
	case "BigUint64Array":
		return unpack(data, 8, order.Uint64)
	case "Float32Array":
		return unpack(data, 4, func(b []byte) float32 { return math.Float32frombits(order.Uint32(b)) })
	case "Float64Array":
		return unpack(data, 8, func(b []byte) float64 { return math.Float64frombits(order.Uint64(b)) })
	}

	return nil, false
}

// decode turns the JSON received from Node.js, with the binary parts of its frame, into plain Go values.
func decode(node any, parts [][]byte) any {

	switch value := node.(type) {

	case json.Number:
		if integer, err := value.Int64(); err == nil {
			return integer
		}

		float, err := value.Float64()

		if err != nil {
			return math.NaN()
		}

		return float

	case []any:
		for index, item := range value {
			value[index] = decode(item, parts)
		}
		return value

	case map[string]any:

		// A reference to a binary part: exactly the keys "$bin" (an index) and "type"
		if len(value) == 2 {
			if number, ok := value["$bin"].(json.Number); ok {
				if kind, ok := value["type"].(string); ok {
					if index, err := number.Int64(); err == nil && index >= 0 && index < int64(len(parts)) {
						if result, ok := typed(kind, parts[index]); ok {
							return result
						}
					}
				}
			}
		}

		for key, item := range value {
			value[key] = decode(item, parts)
		}

		return value
	}

	return node
}

func pack[T any](items []T, size int, write func([]byte, T)) []byte {

	data := make([]byte, len(items)*size)

	for index, item := range items {
		write(data[index*size:], item)
	}

	return data
}

func reference(kind string, data []byte, parts *[][]byte) map[string]any {
	*parts = append(*parts, data)
	return map[string]any{"$bin": len(*parts) - 1, "type": kind}
}

// encode turns what a function returns into what the JSON holds, moving the binary data to parts.
// It understands plain Go values and the slices of numbers; any other type (a struct, a []string) goes through encoding/json.
func encode(value any, parts *[][]byte) (any, error) {

	order := binary.LittleEndian

	switch item := value.(type) {

	case nil, bool, string, json.Number:
		return item, nil

	case Value:
		return encode(item.raw, parts)

	case int:
		return int64(item), nil
	case int8:
		return int64(item), nil
	case int16:
		return int64(item), nil
	case int32:
		return int64(item), nil
	case int64:
		return item, nil
	case uint:
		return unsigned(uint64(item)), nil
	case uint8:
		return int64(item), nil
	case uint16:
		return int64(item), nil
	case uint32:
		return int64(item), nil
	case uint64:
		return unsigned(item), nil

	case float32:
		return finite(float64(item))
	case float64:
		return finite(item)

	case []any:
		output := make([]any, len(item))
		for index, entry := range item {
			converted, err := encode(entry, parts)
			if err != nil {
				return nil, err
			}
			output[index] = converted
		}
		return output, nil

	case map[string]any:
		output := make(map[string]any, len(item))
		for key, entry := range item {
			converted, err := encode(entry, parts)
			if err != nil {
				return nil, err
			}
			output[key] = converted
		}
		return output, nil

	case []Value:
		output := make([]any, len(item))
		for index, entry := range item {
			converted, err := encode(entry.raw, parts)
			if err != nil {
				return nil, err
			}
			output[index] = converted
		}
		return output, nil

	case []byte:
		return reference("Uint8Array", item, parts), nil
	case []int8:
		data := make([]byte, len(item))
		for index, entry := range item {
			data[index] = byte(entry)
		}
		return reference("Int8Array", data, parts), nil
	case []int16:
		return reference("Int16Array", pack(item, 2, func(b []byte, v int16) { order.PutUint16(b, uint16(v)) }), parts), nil
	case []uint16:
		return reference("Uint16Array", pack(item, 2, order.PutUint16), parts), nil
	case []int32:
		return reference("Int32Array", pack(item, 4, func(b []byte, v int32) { order.PutUint32(b, uint32(v)) }), parts), nil
	case []uint32:
		return reference("Uint32Array", pack(item, 4, order.PutUint32), parts), nil
	case []int64:
		return reference("BigInt64Array", pack(item, 8, func(b []byte, v int64) { order.PutUint64(b, uint64(v)) }), parts), nil
	case []uint64:
		return reference("BigUint64Array", pack(item, 8, order.PutUint64), parts), nil
	case []float32:
		return reference("Float32Array", pack(item, 4, func(b []byte, v float32) { order.PutUint32(b, math.Float32bits(v)) }), parts), nil
	case []float64:
		return reference("Float64Array", pack(item, 8, func(b []byte, v float64) { order.PutUint64(b, math.Float64bits(v)) }), parts), nil
	}

	// A struct, a []string, a map[string]int...: JSON knows what to do with them (it cannot carry binary data)
	if reflect.TypeOf(value).Kind() == reflect.Pointer && reflect.ValueOf(value).IsNil() {
		return nil, nil
	}

	data, err := marshal(value)

	if err != nil {
		return nil, notSerializable(err.Error())
	}

	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()

	var output any

	if err := decoder.Decode(&output); err != nil {
		return nil, notSerializable(err.Error())
	}

	return output, nil
}

func unsigned(value uint64) any {
	if value <= math.MaxInt64 {
		return int64(value)
	}
	return float64(value)
}

func finite(value float64) (any, error) {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return nil, notSerializable("NaN and infinity cannot be sent: JSON has no such numbers")
	}
	return value, nil
}
