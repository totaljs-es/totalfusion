package totalfusion

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"testing"
)

func reader(data []byte) *bufio.Reader {
	return bufio.NewReader(bytes.NewReader(data))
}

func TestAFrameSurvivesTheTrip(t *testing.T) {

	var buffer bytes.Buffer

	if err := writeFrame(&buffer, map[string]any{"t": "res", "id": 7}, [][]byte{{1, 2, 3}, {}, bytes.Repeat([]byte{9}, 100)}); err != nil {
		t.Fatal(err)
	}

	frame, parts, err := readFrame(reader(buffer.Bytes()))

	if err != nil {
		t.Fatal(err)
	}

	if number(frame.(map[string]any)["id"]) != 7 {
		t.Fatalf("id: %v", frame)
	}

	if len(parts) != 3 || !bytes.Equal(parts[0], []byte{1, 2, 3}) || len(parts[1]) != 0 || len(parts[2]) != 100 {
		t.Fatalf("parts: %v", parts)
	}
}

func TestABigPartIsWrittenAsItIs(t *testing.T) {

	var buffer bytes.Buffer
	big := bytes.Repeat([]byte{5}, 200*1024)

	if err := writeFrame(&buffer, map[string]any{"n": 1}, [][]byte{big}); err != nil {
		t.Fatal(err)
	}

	_, parts, err := readFrame(reader(buffer.Bytes()))

	if err != nil || len(parts) != 1 || !bytes.Equal(parts[0], big) {
		t.Fatalf("%v %d", err, len(parts))
	}
}

func TestSeveralFramesInARow(t *testing.T) {

	var buffer bytes.Buffer
	_ = writeFrame(&buffer, map[string]any{"n": 1}, nil)
	_ = writeFrame(&buffer, map[string]any{"n": 2}, [][]byte{{5}})

	source := reader(buffer.Bytes())

	for expected := int64(1); expected <= 2; expected++ {
		frame, _, err := readFrame(source)

		if err != nil || number(frame.(map[string]any)["n"]) != expected {
			t.Fatalf("%d: %v %v", expected, frame, err)
		}
	}

	if _, _, err := readFrame(source); err != io.EOF {
		t.Fatalf("expected EOF, got %v", err)
	}
}

func TestAClosedPipeIsNotAnError(t *testing.T) {
	if _, _, err := readFrame(reader(nil)); err != io.EOF {
		t.Fatalf("expected EOF, got %v", err)
	}
}

func TestCorruptFramesAreRejected(t *testing.T) {

	for name, data := range map[string][]byte{
		"a huge length":          {0xff, 0xff, 0xff, 0xff},
		"a frame that is cut":    {0, 0, 0, 2, 0, 0},
		"a length that is wrong": {0, 0, 0, 8, 0, 0, 0, 200, 0, 0, 0, 0},
	} {
		if _, _, err := readFrame(reader(data)); !errors.Is(err, errInvalidFrame) && err == nil {
			t.Errorf("%s was accepted", name)
		}
	}

	// a part that claims to be larger than the frame
	var buffer bytes.Buffer
	_ = writeFrame(&buffer, map[string]any{}, [][]byte{{1, 2}})
	data := buffer.Bytes()
	data[len(data)-3] = 0xff

	if _, _, err := readFrame(reader(data)); err == nil {
		t.Error("a part larger than the frame was accepted")
	}
}

func TestWhatNodeSendsCanBeRead(t *testing.T) {

	// A frame built by hand like lib/protocol.js does: {"t":"ping","id":1} and one part
	data := []byte(`{"t":"ping","id":1}`)
	frame := binary.BigEndian.AppendUint32(nil, uint32(4+len(data)+4+4+2))
	frame = binary.BigEndian.AppendUint32(frame, uint32(len(data)))
	frame = append(frame, data...)
	frame = binary.BigEndian.AppendUint32(frame, 1)
	frame = binary.BigEndian.AppendUint32(frame, 2)
	frame = append(frame, 7, 8)

	message, parts, err := readFrame(reader(frame))

	if err != nil || message.(map[string]any)["t"] != "ping" || !bytes.Equal(parts[0], []byte{7, 8}) {
		t.Fatalf("%v %v %v", message, parts, err)
	}
}

func TestHTMLCharactersAreNotEscaped(t *testing.T) {

	data, err := marshal(map[string]any{"a": "<b>&"})

	if err != nil || string(data) != `{"a":"<b>&"}` {
		t.Fatalf("%s %v", data, err)
	}
}

// A pipe of Windows can refuse a call with a big buffer: these refuse any read or write of more than one chunk
type pickyReader struct{ reader io.Reader }

func (p pickyReader) Read(buf []byte) (int, error) {
	if len(buf) > ioChunk {
		return 0, errors.New("Insufficient system resources exist to complete the requested service")
	}
	return p.reader.Read(buf)
}

type pickyWriter struct{ buffer bytes.Buffer }

func (p *pickyWriter) Write(data []byte) (int, error) {
	if len(data) > ioChunk {
		return 0, errors.New("Insufficient system resources exist to complete the requested service")
	}
	return p.buffer.Write(data)
}

func TestABigFrameIsReadInPieces(t *testing.T) {

	var buffer bytes.Buffer
	big := bytes.Repeat([]byte{7}, 5*ioChunk+123)

	if err := writeFrame(&buffer, map[string]any{"n": 1}, [][]byte{big}); err != nil {
		t.Fatal(err)
	}

	// the same buffer that the worker uses to read the standard input
	source := bufio.NewReaderSize(pickyReader{&buffer}, 1<<20)
	_, parts, err := readFrame(source)

	if err != nil || len(parts) != 1 || !bytes.Equal(parts[0], big) {
		t.Fatalf("%v", err)
	}
}

func TestABigFrameIsWrittenInPieces(t *testing.T) {

	var picky pickyWriter
	big := bytes.Repeat([]byte{9}, 5*ioChunk+123)

	if err := writeFrame(&picky, map[string]any{"n": 1}, [][]byte{big, {1}}); err != nil {
		t.Fatal(err)
	}

	_, parts, err := readFrame(reader(picky.buffer.Bytes()))

	if err != nil || len(parts) != 2 || !bytes.Equal(parts[0], big) || !bytes.Equal(parts[1], []byte{1}) {
		t.Fatalf("%v", err)
	}
}

type shortWriter struct{ buffer bytes.Buffer }

func (s *shortWriter) Write(data []byte) (int, error) {
	return s.buffer.Write(data[:min(len(data), 3)])
}

func TestAWriterThatWritesLessIsAsked_AgainForTheRest(t *testing.T) {

	var short shortWriter

	if err := writeAll(&short, []byte("0123456789")); err != nil || short.buffer.String() != "0123456789" {
		t.Fatalf("%q %v", short.buffer.String(), err)
	}
}
