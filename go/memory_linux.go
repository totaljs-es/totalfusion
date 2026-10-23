//go:build linux

package totalfusion

import (
	"os"
	"strconv"
	"strings"
)

func memory() (uint64, bool) {

	data, err := os.ReadFile("/proc/self/statm")

	if err != nil {
		return 0, false
	}

	fields := strings.Fields(string(data))

	if len(fields) < 2 {
		return 0, false
	}

	resident, err := strconv.ParseUint(fields[1], 10, 64)

	if err != nil {
		return 0, false
	}

	return resident * uint64(os.Getpagesize()), true
}
