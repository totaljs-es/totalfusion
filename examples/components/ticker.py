import time


def ticks(data):
    """A generator: every yield is a chunk that reaches Node.js at once."""
    for number in range(int(data['count'])):
        time.sleep(data['delay'])
        yield {'tick': number, 'at': round(time.time(), 2)}


def ping(data):
    return 'pong'
