//go:build !linux && !windows

package totalfusion

import "runtime/metrics"

// Without cgo there is no way to ask macOS for the footprint of the process, so this is the memory that the Go runtime
// holds and has not given back: what a worker written in Go uses.
func memory() (uint64, bool) {

	samples := []metrics.Sample{{Name: "/memory/classes/total:bytes"}, {Name: "/memory/classes/heap/released:bytes"}}
	metrics.Read(samples)

	if samples[0].Value.Kind() != metrics.KindUint64 || samples[1].Value.Kind() != metrics.KindUint64 {
		return 0, false
	}

	total, released := samples[0].Value.Uint64(), samples[1].Value.Uint64()

	if released > total {
		return total, true
	}

	return total - released, true
}
