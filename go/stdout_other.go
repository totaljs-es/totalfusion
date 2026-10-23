//go:build !unix && !windows

package totalfusion

import (
	"io"
	"os"
)

// On other systems the standard output is not redirected: print to os.Stderr and not to os.Stdout.
func protocolOutput() io.Writer {
	return os.Stdout
}
