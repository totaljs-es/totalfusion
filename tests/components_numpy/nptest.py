import numpy as np

def f32(data): return np.arange(5, dtype=np.float32) * 1.5
def f64_2d(data): return np.arange(6, dtype=np.float64).reshape(2, 3)
def strided(data): return np.arange(10, dtype=np.int32)[::2]
def transposed(data): return np.arange(6, dtype=np.int16).reshape(2, 3).T
def big_endian(data): return np.array([1, 2, 3], dtype='>f4')
def scalar(data): return {'i': np.int64(7), 'f': np.float32(2.5), 'zero_d': np.array(3.0), 'b': np.bool_(True)}
def bools(data): return np.array([True, False, True])
def u8(data): return np.arange(5, dtype=np.uint8)
def f16(data): return np.array([1, 2], dtype=np.float16)
def normalize(data):
    values = np.frombuffer(data['values'], dtype=np.float32)
    return (values - values.mean()) / values.std()
def inspect(data):
    v = data['values']
    return {'len': len(v), 'format': v.format, 'sum': float(np.frombuffer(v, dtype=np.float32).sum()), 'readonly': v.readonly}
