//go:build unix

package totalfusion

import (
	"io"
	"os"
	"syscall"
)

// The real standard output belongs to the protocol. Everything that prints (fmt.Println, a library, C code) goes to the error
// output instead, where Node.js shows it, so it can never break a frame.
func protocolOutput() io.Writer {

	protocol, err := syscall.Dup(1)

	if err != nil {
		return os.Stdout
	}

	if err := duplicate(2, 1); err != nil {
		_ = syscall.Close(protocol)
		return os.Stdout
	}

	syscall.CloseOnExec(protocol)
	return os.NewFile(uintptr(protocol), "protocol")
}
