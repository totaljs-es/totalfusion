import array
import hashlib


def echo(data):
    return data


def length(data):
    return len(data['blob'])


def sha256(data):
    return hashlib.sha256(data['blob']).hexdigest()


def types(data):
    return {key: type(value).__name__ for key, value in data.items()}


def total(data):
    return sum(data['values'])


def make_bytes(data):
    return bytes(range(256)) * data['times']


def make_bytearray(data):
    return bytearray(b'abc')


def make_floats(data):
    return array.array('f', [1.5, 2.5, 3.5])


def make_doubles(data):
    return array.array('d', [0.1, 0.2, 0.3])


def make_ints(data):
    return array.array('i', [-1, 0, 1, 2147483647])


def make_big(data):
    return array.array('q', [-1, 9007199254740993])


def make_view(data):
    return memoryview(bytes(range(10)))[2:6]


def nested(data):
    return {'a': [b'x', b'yz'], 'b': {'c': memoryview(b'abc')}, 'n': 5, 's': 'text'}


def confusable(data):
    return {'$bin': 99, 'type': 'Uint8Array'}


def not_json(data):
    return object()
