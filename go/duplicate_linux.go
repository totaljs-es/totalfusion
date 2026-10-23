//go:build linux

package totalfusion

import "syscall"

// Dup2 does not exist on every architecture of Linux, Dup3 does
func duplicate(from, to int) error {
	return syscall.Dup3(from, to, 0)
}
