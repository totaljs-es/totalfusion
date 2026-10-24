//go:build wasip1

package totalfusion

import (
	"encoding/binary"
	"unsafe"
)

// The ABI that wasm/host.js calls (version 1, see docs/webassembly.md). Every buffer that crosses it is a pointer into the memory of
// the module; the ones that the module returns start with their length (uint32, little endian). A buffer stays alive until it is freed.

var buffers = map[uint32][]byte{}

func hold(size int) ([]byte, uint32) {

	// an empty buffer has no address
	buffer := make([]byte, max(size, 1))
	pointer := uint32(uintptr(unsafe.Pointer(&buffer[0])))
	buffers[pointer] = buffer

	return buffer, pointer
}

// give is the buffer that a function of the ABI returns: the length, and then the bytes
func give(data []byte) uint32 {

	buffer, pointer := hold(4 + len(data))
	binary.LittleEndian.PutUint32(buffer, uint32(len(data)))
	copy(buffer[4:], data)

	return pointer
}

//go:wasmexport tf_abi
func tfABI() uint32 {
	return 1
}

//go:wasmexport tf_alloc
func tfAlloc(size uint32) uint32 {
	_, pointer := hold(int(size))
	return pointer
}

//go:wasmexport tf_free
func tfFree(pointer, size uint32) {
	delete(buffers, pointer)
}

//go:wasmexport tf_describe
func tfDescribe() uint32 {

	if wasmApp == nil {
		return give([]byte(`{"actions":[],"functions":0,"startups":[],"errors":[{"module":"","function":"","message":"` + errNoWasmApp.Error() + `"}]}`))
	}

	return give(wasmApp.wasmDescribe())
}

//go:wasmexport tf_call
func tfCall(namePointer, nameLength, bodyPointer, bodyLength uint32) uint32 {

	if wasmApp == nil {
		return give(wasmResult(nil, NewError(errNoWasmApp.Error())))
	}

	name := string(buffers[namePointer][:nameLength])
	return give(wasmApp.wasmCall(name, buffers[bodyPointer][:bodyLength]))
}
