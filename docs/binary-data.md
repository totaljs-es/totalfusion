# Binary data

`Buffer`, `Uint8Array`, `ArrayBuffer` and the typed arrays (`Float32Array`, `Float64Array`, `Int32Array`, ...) travel as raw bytes next to the JSON, anywhere in the arguments or in the result. No base64, no JSON array of numbers, and the bytes are not copied when the frame is built.

```js
const image = await fs.promises.readFile('photo.jpg');
const result = await fusion.python('vision.resize', { image, width: 256 });   // result.image is a Buffer
```

```python
def resize(data):
    picture = Image.open(io.BytesIO(data['image']))      # data['image'] is bytes
    ...
    return { 'image': output.getvalue() }                  # bytes -> Buffer

def normalize(data):
    values = np.frombuffer(data['values'], dtype=np.float32)   # Float32Array -> memoryview, no copy
    return (values - values.mean()) / values.std()             # numpy array -> Float32Array
```

| JavaScript | Python |
|---|---|
| `Buffer`, `Uint8Array`, `ArrayBuffer` | `bytes` |
| `Int8Array`, `Int16Array`, `Uint16Array`, `Int32Array`, `Uint32Array`, `Float32Array`, `Float64Array`, `BigInt64Array`, `BigUint64Array` | `memoryview` of the matching type (read-only, no copy) |

From Python, `bytes`, `bytearray`, `memoryview`, `array.array` and anything with the buffer protocol (NumPy arrays included) arrive as a `Buffer` (bytes) or the matching typed array. Notes:

- Arrays are sent **flat**: the shape of a multi-dimensional NumPy array is not transmitted. Send it as another field (`{ data, shape }`) if you need it.
- Typed arrays are little-endian, like every platform Node.js and CPython run on (x64 and ARM64). Big-endian buffers coming from Python (NumPy `>f4`) are converted for you.
- Types without a JavaScript typed array (`float16`, complex numbers) arrive as raw bytes in a `Buffer`, as do boolean arrays.
- Non-contiguous NumPy arrays (slices with a step, transposes) are sent in C order.
- `"$bin"` is a reserved key and cannot be used in your data.
- A frame can carry up to 512 MB in total, of which at most 64 MB can be JSON.
- Measured against sending the same bytes as base64 inside JSON: 1 MB in 0.5 ms instead of 4.4 ms, 32 MB in 14 ms instead of 145 ms, and a 100 MB buffer (133 MB as base64, over the JSON limit) in 43 ms.

## In Rust

A Rust worker sends and receives the same data, as the vectors of the matching type:

| JavaScript | Rust (`Value`) |
|---|---|
| `Buffer`, `Uint8Array`, `ArrayBuffer` | `Value::Bytes(Vec<u8>)`, read with `as_bytes()` |
| `Float32Array`, `Float64Array` | `Value::F32`, `Value::F64`, read with `as_f32s()`, `as_f64s()` |
| `Int32Array` | `Value::I32`, read with `as_i32s()` |
| `Int8Array`, `Int16Array`, `Uint16Array`, `Uint32Array`, `BigInt64Array`, `BigUint64Array` | `Value::I8`, `I16`, `U16`, `U32`, `I64`, `U64` |

Returning a `Vec<u8>` or a `Vec<f32>` (they convert into a `Value`) sends a `Buffer` or a `Float32Array` back. The bytes arrive in Rust as a vector (a copy of the frame, one `memcpy`), not as a view. NaN and infinity cannot be sent (JSON has no such numbers): the call fails with `NOT_SERIALIZABLE`. The crate is described in [rust/README.md](../rust/README.md).
