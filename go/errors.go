package totalfusion

import (
	"errors"
	"fmt"
)

// Error is what a function reports when it fails. It reaches JavaScript as an error with the same Name, Message
// and Code, so Name should say what kind of failure it is.
//
// Use Invalid for a mistake of the caller (bad input): Total.js sends its message to the client.
// Any other failure stays in the log of the server and the client only learns that the action failed.
// A plain Go error returned by a function is reported as an Error named "Error".
type Error struct {
	Name    string
	Message string
	Code    string
}

func (e *Error) Error() string {
	return e.Name + ": " + e.Message
}

// WithCode sets the code of the error and returns it.
func (e *Error) WithCode(code string) *Error {
	e.Code = code
	return e
}

// NewError is a failure of the function.
func NewError(message string) *Error {
	return &Error{Name: "Error", Message: message}
}

// Errorf is NewError with a format.
func Errorf(format string, args ...any) *Error {
	return NewError(fmt.Sprintf(format, args...))
}

// Invalid is a mistake of the caller: the input is not valid.
func Invalid(message string) *Error {
	return &Error{Name: "ValueError", Message: message}
}

// Invalidf is Invalid with a format.
func Invalidf(format string, args ...any) *Error {
	return Invalid(fmt.Sprintf(format, args...))
}

// Named is a failure with a name of your own.
func Named(name, message string) *Error {
	return &Error{Name: name, Message: message}
}

// ErrCancelled is what Emit returns when Node.js gave up on the call: a stream should simply return it.
var ErrCancelled = &Error{Name: "Cancelled", Message: "The call was cancelled", Code: "CANCELLED"}

// IsCancelled is true when the error says that Node.js cancelled the call.
func IsCancelled(err error) bool {
	var found *Error
	return errors.As(err, &found) && found.Code == "CANCELLED"
}

func notSerializable(message string) *Error {
	return &Error{Name: "TypeError", Message: message, Code: "NOT_SERIALIZABLE"}
}

func notFound(message string) *Error {
	return &Error{Name: "LookupError", Message: message, Code: "NOT_FOUND"}
}

// toError is the error that goes to JavaScript: the *Error that the function returned (even wrapped), or a plain one.
func toError(err error) *Error {
	var found *Error

	if errors.As(err, &found) && found != nil {
		return found
	}

	return NewError(err.Error())
}
