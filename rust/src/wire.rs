//! The frames of the protocol (version 2). All the integers are uint32 big endian:
//!
//! `total | json length | json | count | length of each part | the parts`
//!
//! `total` is the size of everything after it. It is the same format that the Python worker speaks.

use std::io::{self, Read, Write};
use std::ops::Range;

pub(crate) const VERSION: u64 = 2;
const MAX_FRAME: usize = 512 * 1024 * 1024;
const MAX_JSON: usize = 64 * 1024 * 1024;

pub(crate) struct Frame {
    pub json: serde_json::Value,
    body: Vec<u8>,
    parts: Vec<Range<usize>>,
}

impl Frame {
    /// The binary parts, without copying them.
    pub fn parts(&self) -> Vec<&[u8]> {
        self.parts.iter().map(|range| &self.body[range.clone()]).collect()
    }
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.to_string())
}

fn read_u32(bytes: &[u8], at: usize) -> io::Result<usize> {
    bytes.get(at..at + 4).map(|slice| u32::from_be_bytes(slice.try_into().unwrap()) as usize).ok_or_else(|| invalid("truncated frame"))
}

/// The next frame, or `None` when the other side closed the pipe.
pub(crate) fn read_frame<R: Read>(reader: &mut R) -> io::Result<Option<Frame>> {
    let mut head = [0u8; 4];

    match reader.read_exact(&mut head) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error),
    }

    let total = u32::from_be_bytes(head) as usize;

    if !(8..=MAX_FRAME).contains(&total) {
        return Err(invalid("invalid frame length"));
    }

    let mut body = vec![0u8; total];
    reader.read_exact(&mut body)?;

    let json_length = read_u32(&body, 0)?;
    let json_end = 4usize.checked_add(json_length).filter(|end| *end <= total).ok_or_else(|| invalid("invalid json length"))?;
    let json = serde_json::from_slice(&body[4..json_end]).map_err(|error| invalid(&error.to_string()))?;

    let count = read_u32(&body, json_end)?;
    let table = json_end + 4;
    let mut offset = count.checked_mul(4).and_then(|size| table.checked_add(size)).filter(|end| *end <= total).ok_or_else(|| invalid("invalid table of parts"))?;
    let mut parts = Vec::with_capacity(count);

    for index in 0..count {
        let length = read_u32(&body, table + index * 4)?;
        let end = offset.checked_add(length).filter(|end| *end <= total).ok_or_else(|| invalid("a part is larger than the frame"))?;
        parts.push(offset..end);
        offset = end;
    }

    if offset != total {
        return Err(invalid("the parts do not match the size of the frame"));
    }

    Ok(Some(Frame { json, body, parts }))
}

/// Writes a frame: the binary parts are written as they are.
pub(crate) fn write_frame<W: Write>(writer: &mut W, json: &serde_json::Value, parts: &[Vec<u8>]) -> io::Result<()> {
    let json = serde_json::to_vec(json).map_err(|error| invalid(&error.to_string()))?;

    if json.len() > MAX_JSON {
        return Err(invalid("the JSON part of the message is too large"));
    }

    let size = 4 + json.len() + 4 + parts.len() * 4 + parts.iter().map(Vec::len).sum::<usize>();

    if size > MAX_FRAME {
        return Err(invalid("the message is too large"));
    }

    let mut head = Vec::with_capacity(8 + json.len() + 4 + parts.len() * 4);
    head.extend_from_slice(&(size as u32).to_be_bytes());
    head.extend_from_slice(&(json.len() as u32).to_be_bytes());
    head.extend_from_slice(&json);
    head.extend_from_slice(&(parts.len() as u32).to_be_bytes());

    for part in parts {
        head.extend_from_slice(&(part.len() as u32).to_be_bytes());
    }

    writer.write_all(&head)?;

    for part in parts {
        writer.write_all(part)?;
    }

    writer.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_frame_survives_the_trip() {
        let mut bytes = Vec::new();
        write_frame(&mut bytes, &serde_json::json!({ "t": "res", "id": 7 }), &[vec![1, 2, 3], vec![], vec![9; 100]]).unwrap();

        let frame = read_frame(&mut bytes.as_slice()).unwrap().unwrap();
        assert_eq!(frame.json["id"], 7);

        let parts = frame.parts();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0], &[1, 2, 3]);
        assert!(parts[1].is_empty());
        assert_eq!(parts[2].len(), 100);
    }

    #[test]
    fn several_frames_in_a_row() {
        let mut bytes = Vec::new();
        write_frame(&mut bytes, &serde_json::json!({ "n": 1 }), &[]).unwrap();
        write_frame(&mut bytes, &serde_json::json!({ "n": 2 }), &[vec![5]]).unwrap();

        let mut reader = bytes.as_slice();
        assert_eq!(read_frame(&mut reader).unwrap().unwrap().json["n"], 1);
        assert_eq!(read_frame(&mut reader).unwrap().unwrap().json["n"], 2);
        assert!(read_frame(&mut reader).unwrap().is_none());
    }

    #[test]
    fn a_closed_pipe_is_not_an_error() {
        assert!(read_frame(&mut &[][..]).unwrap().is_none());
    }

    #[test]
    fn corrupt_frames_are_rejected() {
        assert!(read_frame(&mut &[0xff, 0xff, 0xff, 0xff][..]).is_err());
        assert!(read_frame(&mut &[0, 0, 0, 2, 0, 0][..]).is_err());

        // a part that claims to be larger than the frame
        let mut bytes = Vec::new();
        write_frame(&mut bytes, &serde_json::json!({}), &[vec![1, 2]]).unwrap();
        let last = bytes.len() - 3;
        bytes[last] = 0xff;
        assert!(read_frame(&mut bytes.as_slice()).is_err());
    }

    #[test]
    fn what_node_sends_can_be_read() {
        // A frame built by hand like lib/protocol.js does: {"t":"ping","id":1} and one part
        let json = br#"{"t":"ping","id":1}"#;
        let mut frame = Vec::new();
        let total = 4 + json.len() + 4 + 4 + 2;
        frame.extend_from_slice(&(total as u32).to_be_bytes());
        frame.extend_from_slice(&(json.len() as u32).to_be_bytes());
        frame.extend_from_slice(json);
        frame.extend_from_slice(&1u32.to_be_bytes());
        frame.extend_from_slice(&2u32.to_be_bytes());
        frame.extend_from_slice(&[7, 8]);

        let read = read_frame(&mut frame.as_slice()).unwrap().unwrap();
        assert_eq!(read.json["t"], "ping");
        assert_eq!(read.parts()[0], &[7, 8]);
    }
}
