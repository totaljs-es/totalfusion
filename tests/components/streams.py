import asyncio
import os
import time

state = {'closed': False}


def numbers(data):
    for i in range(data['n']):
        yield data.get('start', 0) + i


async def ticks(data):
    for i in range(data['n']):
        await asyncio.sleep(data['delay'])
        yield {'tick': i}


def blobs(data):
    for i in range(data['n']):
        yield {'i': i, 'blob': bytes([i]) * 1000}


def empty(data):
    return
    yield


def with_return_value(data):
    yield 1
    return 'ignored'


def fails_midway(data):
    yield 1
    yield 2
    raise ValueError('boom after two chunks')


def not_serializable_chunk(data):
    yield 1
    yield {1, 2, 3}


def endless(data):
    """Writes how far it got, so the test can see the backpressure."""
    i = 0
    while True:
        # atomic, so the test never reads a half written file
        with open(data['file'] + '.tmp', 'w') as f:
            f.write(str(i))
        os.replace(data['file'] + '.tmp', data['file'])
        yield i
        i += 1


async def endless_async(data):
    i = 0
    state['closed'] = False
    try:
        while True:
            yield i
            i += 1
            await asyncio.sleep(0.001)
    finally:
        state['closed'] = True


def endless_sync(data):
    i = 0
    state['closed'] = False
    try:
        while True:
            yield i
            i += 1
    finally:
        state['closed'] = True


async def burst_then_silence(data):
    yield 'first'
    await asyncio.sleep(5)
    yield 'never'


def stuck_after_first(data):
    yield 'first'
    time.sleep(5)
    yield 'never'


def crash_midway(data):
    yield 'first'
    os._exit(3)


def single(data):
    return 'single'


def closed(data):
    return state['closed']


def pid(data):
    return os.getpid()
