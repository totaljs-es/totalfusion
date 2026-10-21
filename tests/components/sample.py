import asyncio
import os
import time
from os import getcwd  # imported names must not be callable from Node.js


def add(data):
    return data['a'] + data['b']


def echo(data):
    return data


def text_length(data):
    return {'success': True, 'result': len(data['text'])}


def boom(data):
    raise ValueError('something went wrong')


def printer(data):
    print('this goes to stderr, not to the protocol')
    os.write(1, b'raw bytes written to fd 1\n')
    return 'ok'


async def sleep_async(data):
    await asyncio.sleep(data['seconds'])
    return 'done'


def sleep_sync(data):
    time.sleep(data['seconds'])
    return 'done'


def crash(data):
    os._exit(3)


def not_serializable(data):
    return {'value': {1, 2, 3}}


def pid(data):
    return os.getpid()


def slow_pid(data):
    time.sleep(data['seconds'])
    return os.getpid()


def _private(data):
    return 'private'
