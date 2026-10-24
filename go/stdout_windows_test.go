//go:build windows

package totalfusion

import (
	"os"
	"runtime"
	"testing"
	"time"
)

// A bug that only shows after the garbage collector has run: the handle of the protocol was closed by the finalizer of a file
// that nothing referred to any more, and the worker could not answer. It was found in Windows with big payloads.
func TestTheHandleOfTheProtocolSurvivesTheGarbageCollector(t *testing.T) {

	out := protocolOutput()
	file, ok := out.(*os.File)

	if !ok {
		t.Skip("there is no handle to protect")
	}

	// the finalizers run in a goroutine after the collection
	for i := 0; i < 5; i++ {
		runtime.GC()
		time.Sleep(20 * time.Millisecond)
	}

	if _, err := file.Stat(); err != nil {
		t.Fatalf("the handle of the protocol is not valid after the garbage collector ran: %v", err)
	}
}
