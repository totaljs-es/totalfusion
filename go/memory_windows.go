//go:build windows

package totalfusion

import (
	"syscall"
	"unsafe"
)

var (
	kernel32             = syscall.NewLazyDLL("kernel32.dll")
	getProcessMemoryInfo = kernel32.NewProc("K32GetProcessMemoryInfo")
)

// PROCESS_MEMORY_COUNTERS_EX: PrivateUsage is the memory that only this process uses (what Task Manager calls "Memory")
type counters struct {
	size                       uint32
	pageFaultCount             uint32
	peakWorkingSetSize         uintptr
	workingSetSize             uintptr
	quotaPeakPagedPoolUsage    uintptr
	quotaPagedPoolUsage        uintptr
	quotaPeakNonPagedPoolUsage uintptr
	quotaNonPagedPoolUsage     uintptr
	pagefileUsage              uintptr
	peakPagefileUsage          uintptr
	privateUsage               uintptr
}

func memory() (uint64, bool) {

	process, err := syscall.GetCurrentProcess()

	if err != nil {
		return 0, false
	}

	var info counters
	info.size = uint32(unsafe.Sizeof(info))

	result, _, _ := getProcessMemoryInfo.Call(uintptr(process), uintptr(unsafe.Pointer(&info)), uintptr(info.size))

	if result == 0 {
		return 0, false
	}

	return uint64(info.privateUsage), true
}
