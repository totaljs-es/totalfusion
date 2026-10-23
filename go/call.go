package totalfusion

import (
	"context"
	"sync"
)

// Call is what a function is told about the call, and what it uses to answer a stream.
type Call struct {
	// Args are the arguments, as Node.js sent them.
	Args Value

	id     int64
	ctx    context.Context
	cancel context.CancelFunc
	writer *writer

	mutex  sync.Mutex
	credit int64
	wake   chan struct{}
}

func newCall(id int64, args Value, credit int64, writer *writer) *Call {
	ctx, cancel := context.WithCancel(context.Background())
	return &Call{Args: args, id: id, ctx: ctx, cancel: cancel, writer: writer, credit: credit, wake: make(chan struct{})}
}

// Context is cancelled when Node.js gives up on the call (timeout, abort) or the worker is asked to stop. Pass it to what the
// function calls (a database, an HTTP request) so that the work stops too.
func (c *Call) Context() context.Context {
	return c.ctx
}

// Cancelled is true when Node.js gave up on this call. A long function should look at it from time to time and stop.
func (c *Call) Cancelled() bool {
	return c.ctx.Err() != nil
}

func (c *Call) addCredit(amount int64) {
	c.mutex.Lock()
	c.credit += amount
	close(c.wake)
	c.wake = make(chan struct{})
	c.mutex.Unlock()
}

// Emit sends a chunk of a stream. It waits when the consumer is slow (that is the backpressure) and returns ErrCancelled when it
// stops reading: return that error and the stream ends.
func (c *Call) Emit(value any) error {

	for {
		if c.Cancelled() {
			return ErrCancelled
		}

		c.mutex.Lock()

		if c.credit > 0 {
			c.credit--
			c.mutex.Unlock()
			break
		}

		wake := c.wake
		c.mutex.Unlock()

		select {
		case <-wake:
		case <-c.ctx.Done():
			return ErrCancelled
		}
	}

	var parts [][]byte
	data, err := encode(value, &parts)

	if err != nil {
		return err
	}

	c.writer.send(map[string]any{"t": "chunk", "id": c.id, "data": data}, parts)
	return nil
}
