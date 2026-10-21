import asyncio
import os
import time

hog = []


def pid(data):
    return os.getpid()


def echo(data):
    return data


def leak(data):
    """Keeps `mb` megabytes alive for as long as the worker lives."""
    hog.append(b'x' * (data['mb'] * 1024 * 1024))
    return len(hog)


def held(data):
    return len(hog)


async def wedge(data):
    """Answers at once and then blocks the event loop: an idle worker that no longer answers."""
    asyncio.get_running_loop().call_later(0.05, time.sleep, 30)
    return 'ok'


async def block(data):
    """Blocks the event loop while it works, like a C extension that does not release the GIL."""
    time.sleep(data['seconds'])
    return 'done'
