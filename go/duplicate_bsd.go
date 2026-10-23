//go:build unix && !linux

package totalfusion

import "syscall"

func duplicate(from, to int) error {
	return syscall.Dup2(from, to)
}
