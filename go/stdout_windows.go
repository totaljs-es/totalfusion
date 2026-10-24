//go:build windows

package totalfusion

import (
	"io"
	"os"
	"syscall"
)

var setStdHandle = kernel32.NewProc("SetStdHandle")

// The file that Go made for the standard output when the program started. It owns the handle of the pipe of the protocol, and it is
// kept here for as long as the program runs: if nothing referred to it any more, the garbage collector would run its finalizer,
// which closes the handle, and the protocol would write to a handle that is not valid ("write protocol: The handle is invalid")
// as soon as the program had allocated enough for the collector to run.
var protocolFile *os.File

// On Windows the handle of the standard output is taken for the protocol, and the standard output of the process is pointed
// to the error output, so what prints (fmt.Println, a library) goes there and never breaks a frame.
func protocolOutput() io.Writer {

	protocol, err := syscall.GetStdHandle(syscall.STD_OUTPUT_HANDLE)
	errors, failed := syscall.GetStdHandle(syscall.STD_ERROR_HANDLE)

	// Without a usable handle there is nothing to protect: fall back to the standard output
	if err != nil || failed != nil || protocol == 0 || protocol == syscall.InvalidHandle || errors == 0 || errors == syscall.InvalidHandle {
		return os.Stdout
	}

	// The id of the standard output is the number -11, as a 32 bit unsigned integer
	id := syscall.STD_OUTPUT_HANDLE

	if result, _, _ := setStdHandle.Call(uintptr(uint32(id)), uintptr(errors)); result == 0 {
		return os.Stdout
	}

	// The same file, not another one for the same handle: two files with one handle close it twice, or when the first is collected
	protocolFile = os.Stdout
	os.Stdout = os.Stderr

	return protocolFile
}
