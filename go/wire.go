package totalfusion

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

// The frames of the protocol (version 2). All the integers are uint32 big endian:
//
//	total | json length | json | count | length of each part | the parts
//
// total is the size of everything after it. It is the same format that the Python and Rust workers speak.

const (
	protocolVersion = 2
	maxFrame        = 512 * 1024 * 1024
	maxJSON         = 64 * 1024 * 1024
)

var errInvalidFrame = errors.New("invalid frame")

func invalidFrame(what string) error {
	return fmt.Errorf("%w: %s", errInvalidFrame, what)
}

// readFrame is the next frame: its JSON and its binary parts (slices of the frame, not copies). io.EOF when the other side closed the pipe.
func readFrame(reader *bufio.Reader) (any, [][]byte, error) {

	var head [4]byte

	if _, err := io.ReadFull(reader, head[:]); err != nil {
		if err == io.ErrUnexpectedEOF {
			err = io.EOF
		}
		return nil, nil, err
	}

	total := int(binary.BigEndian.Uint32(head[:]))

	if total < 8 || total > maxFrame {
		return nil, nil, invalidFrame("invalid frame length")
	}

	body := make([]byte, total)

	if _, err := io.ReadFull(reader, body); err != nil {
		return nil, nil, err
	}

	jsonLength := int(binary.BigEndian.Uint32(body))
	jsonEnd := 4 + jsonLength

	if jsonEnd < 4 || jsonEnd+4 > total {
		return nil, nil, invalidFrame("invalid json length")
	}

	decoder := json.NewDecoder(bytes.NewReader(body[4:jsonEnd]))
	decoder.UseNumber()

	var message any

	if err := decoder.Decode(&message); err != nil {
		return nil, nil, invalidFrame(err.Error())
	}

	count := int(binary.BigEndian.Uint32(body[jsonEnd:]))
	table := jsonEnd + 4

	if count < 0 || count > (total-table)/4 {
		return nil, nil, invalidFrame("invalid table of parts")
	}

	offset := table + count*4
	parts := make([][]byte, count)

	for index := 0; index < count; index++ {

		length := int(binary.BigEndian.Uint32(body[table+index*4:]))

		if length < 0 || length > total-offset {
			return nil, nil, invalidFrame("a part is larger than the frame")
		}

		parts[index] = body[offset : offset+length : offset+length]
		offset += length
	}

	if offset != total {
		return nil, nil, invalidFrame("the parts do not match the size of the frame")
	}

	return message, parts, nil
}

func marshal(value any) ([]byte, error) {

	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)

	if err := encoder.Encode(value); err != nil {
		return nil, err
	}

	return bytes.TrimRight(buffer.Bytes(), "\n"), nil
}

// writeFrame writes a frame: the binary parts are written as they are, not copied into the JSON.
func writeFrame(writer io.Writer, message any, parts [][]byte) error {

	data, err := marshal(message)

	if err != nil {
		return invalidFrame(err.Error())
	}

	if len(data) > maxJSON {
		return invalidFrame("the JSON part of the message is too large")
	}

	size := 4 + len(data) + 4 + len(parts)*4
	binaryLength := 0

	for _, part := range parts {
		binaryLength += len(part)
	}

	if size+binaryLength > maxFrame {
		return invalidFrame("the message is too large")
	}

	head := make([]byte, 0, 8+len(data)+4+len(parts)*4)
	head = binary.BigEndian.AppendUint32(head, uint32(size+binaryLength))
	head = binary.BigEndian.AppendUint32(head, uint32(len(data)))
	head = append(head, data...)
	head = binary.BigEndian.AppendUint32(head, uint32(len(parts)))

	for _, part := range parts {
		head = binary.BigEndian.AppendUint32(head, uint32(len(part)))
	}

	// What is small goes in one write
	if binaryLength <= 32*1024 {
		for _, part := range parts {
			head = append(head, part...)
		}

		_, err = writer.Write(head)
		return err
	}

	if _, err = writer.Write(head); err != nil {
		return err
	}

	for _, part := range parts {
		if _, err = writer.Write(part); err != nil {
			return err
		}
	}

	return nil
}
