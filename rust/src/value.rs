use std::collections::BTreeMap;
use std::ops::Index;

use crate::error::Error;

static NULL: Value = Value::Null;

/// A value that crosses the boundary with Node.js: everything JSON can hold, plus binary data.
///
/// `Buffer` and `Uint8Array` are `Bytes`. The other typed arrays of JavaScript (`Float32Array`, `Int32Array`, ...)
/// are the vectors of the matching type and travel as raw bytes, without going through JSON.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    String(String),
    Array(Vec<Value>),
    Object(BTreeMap<String, Value>),
    Bytes(Vec<u8>),
    I8(Vec<i8>),
    I16(Vec<i16>),
    U16(Vec<u16>),
    I32(Vec<i32>),
    U32(Vec<u32>),
    I64(Vec<i64>),
    U64(Vec<u64>),
    F32(Vec<f32>),
    F64(Vec<f64>),
}

impl Value {
    /// An array from anything that can be turned into values: `Value::array([1, 2, 3])`.
    pub fn array<T: Into<Value>>(items: impl IntoIterator<Item = T>) -> Value {
        Value::Array(items.into_iter().map(Into::into).collect())
    }

    pub fn is_null(&self) -> bool {
        matches!(self, Value::Null)
    }

    /// The member `key` of an object.
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Object(map) => map.get(key),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Value::Bool(value) => Some(*value),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::String(value) => Some(value),
            _ => None,
        }
    }

    /// Any number, as a float.
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Value::Int(value) => Some(*value as f64),
            Value::Float(value) => Some(*value),
            _ => None,
        }
    }

    /// An integer, or a float that has no decimals.
    pub fn as_i64(&self) -> Option<i64> {
        match self {
            Value::Int(value) => Some(*value),
            Value::Float(value) if value.fract() == 0.0 && value.abs() < 9.0e15 => Some(*value as i64),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&Vec<Value>> {
        match self {
            Value::Array(items) => Some(items),
            _ => None,
        }
    }

    pub fn as_object(&self) -> Option<&BTreeMap<String, Value>> {
        match self {
            Value::Object(map) => Some(map),
            _ => None,
        }
    }

    /// The bytes of a `Buffer` or a `Uint8Array`.
    pub fn as_bytes(&self) -> Option<&[u8]> {
        match self {
            Value::Bytes(bytes) => Some(bytes),
            _ => None,
        }
    }

    pub fn as_f32s(&self) -> Option<&[f32]> {
        match self {
            Value::F32(items) => Some(items),
            _ => None,
        }
    }

    pub fn as_f64s(&self) -> Option<&[f64]> {
        match self {
            Value::F64(items) => Some(items),
            _ => None,
        }
    }

    pub fn as_i32s(&self) -> Option<&[i32]> {
        match self {
            Value::I32(items) => Some(items),
            _ => None,
        }
    }
}

/// `value["key"]` is the member of an object, or `Null` when there is none (it never panics).
impl Index<&str> for Value {
    type Output = Value;

    fn index(&self, key: &str) -> &Value {
        self.get(key).unwrap_or(&NULL)
    }
}

/// `value[0]` is the item of an array, or `Null` when there is none.
impl Index<usize> for Value {
    type Output = Value;

    fn index(&self, index: usize) -> &Value {
        match self {
            Value::Array(items) => items.get(index).unwrap_or(&NULL),
            _ => &NULL,
        }
    }
}

macro_rules! from_value {
    ($($type:ty => |$name:ident| $body:expr),* $(,)?) => {
        $(impl From<$type> for Value {
            fn from($name: $type) -> Value {
                $body
            }
        })*
    };
}

from_value! {
    () => |_value| Value::Null,
    bool => |value| Value::Bool(value),
    i32 => |value| Value::Int(value as i64),
    i64 => |value| Value::Int(value),
    u32 => |value| Value::Int(value as i64),
    u64 => |value| if value <= i64::MAX as u64 { Value::Int(value as i64) } else { Value::Float(value as f64) },
    usize => |value| Value::from(value as u64),
    f32 => |value| Value::Float(value as f64),
    f64 => |value| Value::Float(value),
    &str => |value| Value::String(value.to_string()),
    String => |value| Value::String(value),
    Vec<u8> => |value| Value::Bytes(value),
    Vec<i8> => |value| Value::I8(value),
    Vec<i16> => |value| Value::I16(value),
    Vec<u16> => |value| Value::U16(value),
    Vec<i32> => |value| Value::I32(value),
    Vec<u32> => |value| Value::U32(value),
    Vec<i64> => |value| Value::I64(value),
    Vec<u64> => |value| Value::U64(value),
    Vec<f32> => |value| Value::F32(value),
    Vec<f64> => |value| Value::F64(value),
    BTreeMap<String, Value> => |value| Value::Object(value),
}

impl<T: Into<Value>> From<Option<T>> for Value {
    fn from(value: Option<T>) -> Value {
        match value {
            Some(value) => value.into(),
            None => Value::Null,
        }
    }
}

/// Builds an object: `object! { "sum" => 3, "name" => "total" }`.
#[macro_export]
macro_rules! object {
    ($($key:expr => $value:expr),* $(,)?) => {{
        #[allow(unused_mut)]
        let mut map = ::std::collections::BTreeMap::new();
        $(map.insert(::std::string::String::from($key), $crate::Value::from($value));)*
        $crate::Value::Object(map)
    }};
}

// ---------------------------------------------------------------------------------------------
// The wire format. Binary data is not in the JSON: it is replaced by { "$bin": index, "type": "Float32Array" }
// and travels raw after the JSON (see wire.rs).
// ---------------------------------------------------------------------------------------------

macro_rules! typed_from_bytes {
    ($bytes:expr, $variant:ident, $type:ty) => {{
        const SIZE: usize = std::mem::size_of::<$type>();
        if $bytes.len() % SIZE != 0 {
            None
        } else {
            Some(Value::$variant($bytes.chunks_exact(SIZE).map(|chunk| <$type>::from_le_bytes(chunk.try_into().unwrap())).collect()))
        }
    }};
}

fn typed(kind: &str, bytes: &[u8]) -> Option<Value> {
    match kind {
        "Uint8Array" => Some(Value::Bytes(bytes.to_vec())),
        "Int8Array" => Some(Value::I8(bytes.iter().map(|byte| *byte as i8).collect())),
        "Int16Array" => typed_from_bytes!(bytes, I16, i16),
        "Uint16Array" => typed_from_bytes!(bytes, U16, u16),
        "Int32Array" => typed_from_bytes!(bytes, I32, i32),
        "Uint32Array" => typed_from_bytes!(bytes, U32, u32),
        "BigInt64Array" => typed_from_bytes!(bytes, I64, i64),
        "BigUint64Array" => typed_from_bytes!(bytes, U64, u64),
        "Float32Array" => typed_from_bytes!(bytes, F32, f32),
        "Float64Array" => typed_from_bytes!(bytes, F64, f64),
        _ => None,
    }
}

/// JSON received from Node.js, with the binary parts of its frame, as a `Value`.
pub(crate) fn from_json(json: &serde_json::Value, parts: &[&[u8]]) -> Value {
    match json {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(value) => Value::Bool(*value),
        serde_json::Value::Number(number) => match number.as_i64() {
            Some(value) => Value::Int(value),
            None => Value::Float(number.as_f64().unwrap_or(f64::NAN)),
        },
        serde_json::Value::String(value) => Value::String(value.clone()),
        serde_json::Value::Array(items) => Value::Array(items.iter().map(|item| from_json(item, parts)).collect()),
        serde_json::Value::Object(map) => {
            // A reference to a binary part: exactly the keys "$bin" (an index) and "type"
            if map.len() == 2 {
                if let (Some(index), Some(kind)) = (map.get("$bin").and_then(|value| value.as_u64()), map.get("type").and_then(|value| value.as_str())) {
                    if let Some(value) = parts.get(index as usize).and_then(|bytes| typed(kind, bytes)) {
                        return value;
                    }
                }
            }
            Value::Object(map.iter().map(|(key, item)| (key.clone(), from_json(item, parts))).collect())
        }
    }
}

macro_rules! typed_to_bytes {
    ($items:expr, $type:ty, $name:expr, $parts:expr) => {{
        let mut bytes = Vec::with_capacity($items.len() * std::mem::size_of::<$type>());
        for item in $items {
            bytes.extend_from_slice(&item.to_le_bytes());
        }
        reference($name, bytes, $parts)
    }};
}

fn reference(kind: &str, bytes: Vec<u8>, parts: &mut Vec<Vec<u8>>) -> serde_json::Value {
    parts.push(bytes);
    let mut map = serde_json::Map::new();
    map.insert("$bin".to_string(), serde_json::Value::from(parts.len() - 1));
    map.insert("type".to_string(), serde_json::Value::from(kind));
    serde_json::Value::Object(map)
}

/// A `Value` as JSON, moving its binary data to `parts`.
pub(crate) fn to_json(value: &Value, parts: &mut Vec<Vec<u8>>) -> Result<serde_json::Value, Error> {
    Ok(match value {
        Value::Null => serde_json::Value::Null,
        Value::Bool(value) => serde_json::Value::Bool(*value),
        Value::Int(value) => serde_json::Value::from(*value),
        Value::Float(value) => match serde_json::Number::from_f64(*value) {
            Some(number) => serde_json::Value::Number(number),
            None => return Err(Error::not_serializable("NaN and infinity cannot be sent: JSON has no such numbers")),
        },
        Value::String(value) => serde_json::Value::String(value.clone()),
        Value::Array(items) => {
            let mut output = Vec::with_capacity(items.len());
            for item in items {
                output.push(to_json(item, parts)?);
            }
            serde_json::Value::Array(output)
        }
        Value::Object(map) => {
            let mut output = serde_json::Map::new();
            for (key, item) in map {
                output.insert(key.clone(), to_json(item, parts)?);
            }
            serde_json::Value::Object(output)
        }
        Value::Bytes(bytes) => reference("Uint8Array", bytes.clone(), parts),
        Value::I8(items) => reference("Int8Array", items.iter().map(|item| *item as u8).collect(), parts),
        Value::I16(items) => typed_to_bytes!(items, i16, "Int16Array", parts),
        Value::U16(items) => typed_to_bytes!(items, u16, "Uint16Array", parts),
        Value::I32(items) => typed_to_bytes!(items, i32, "Int32Array", parts),
        Value::U32(items) => typed_to_bytes!(items, u32, "Uint32Array", parts),
        Value::I64(items) => typed_to_bytes!(items, i64, "BigInt64Array", parts),
        Value::U64(items) => typed_to_bytes!(items, u64, "BigUint64Array", parts),
        Value::F32(items) => typed_to_bytes!(items, f32, "Float32Array", parts),
        Value::F64(items) => typed_to_bytes!(items, f64, "Float64Array", parts),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round_trip(value: &Value) -> Value {
        let mut parts = Vec::new();
        let json = to_json(value, &mut parts).unwrap();
        let slices: Vec<&[u8]> = parts.iter().map(|part| part.as_slice()).collect();
        from_json(&json, &slices)
    }

    #[test]
    fn json_values_survive() {
        let value = object! { "a" => 1, "b" => "text", "c" => 2.5, "d" => true, "e" => Value::Null, "f" => Value::array([1, 2, 3]) };
        assert_eq!(round_trip(&value), value);
    }

    #[test]
    fn binary_data_survives_in_every_type() {
        let value = object! {
            "bytes" => vec![1u8, 2, 255],
            "i8" => vec![-1i8, 5],
            "i16" => vec![-300i16, 300],
            "u16" => vec![0u16, 65535],
            "i32" => vec![i32::MIN, 7, i32::MAX],
            "u32" => vec![0u32, u32::MAX],
            "i64" => vec![i64::MIN, 1],
            "u64" => vec![0u64, u64::MAX],
            "f32" => vec![1.5f32, -2.25],
            "f64" => vec![0.1f64, f64::MAX],
        };
        assert_eq!(round_trip(&value), value);
    }

    #[test]
    fn binary_data_is_not_in_the_json() {
        let mut parts = Vec::new();
        let json = to_json(&object! { "image" => vec![0u8; 1000] }, &mut parts).unwrap();
        assert_eq!(json.to_string(), r#"{"image":{"$bin":0,"type":"Uint8Array"}}"#);
        assert_eq!(parts[0].len(), 1000);
    }

    #[test]
    fn an_object_that_looks_like_a_reference_is_left_alone() {
        let json = serde_json::json!({ "$bin": 5, "type": "Uint8Array" });
        let value = from_json(&json, &[]);
        assert_eq!(value["$bin"].as_i64(), Some(5));
    }

    #[test]
    fn a_part_with_the_wrong_size_is_left_alone() {
        let json = serde_json::json!({ "$bin": 0, "type": "Float32Array" });
        let value = from_json(&json, &[&[1u8, 2, 3][..]]);
        assert!(value.as_f32s().is_none());
    }

    #[test]
    fn indexing_never_panics() {
        let value = object! { "list" => Value::array([10, 20]) };
        assert_eq!(value["list"][1].as_i64(), Some(20));
        assert!(value["missing"]["deeper"][3].is_null());
        assert!(Value::Int(1)["key"].is_null());
    }

    #[test]
    fn numbers_convert_as_expected() {
        assert_eq!(Value::Float(3.0).as_i64(), Some(3));
        assert_eq!(Value::Float(3.5).as_i64(), None);
        assert_eq!(Value::Int(3).as_f64(), Some(3.0));
        assert_eq!(Value::from(u64::MAX), Value::Float(u64::MAX as f64));
    }

    #[test]
    fn nan_cannot_be_sent() {
        let mut parts = Vec::new();
        assert!(to_json(&Value::Float(f64::NAN), &mut parts).is_err());
    }
}
