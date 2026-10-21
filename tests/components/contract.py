import os
from totalfusion import action, startup, shutdown

state = {'loaded': 0, 'pid': None}


@startup
def load():
    state['loaded'] += 1
    state['pid'] = os.getpid()


@shutdown
def unload():
    path = os.environ.get('FUSION_TEST_SHUTDOWN_FILE')
    if path:
        with open(path, 'w') as f:
            f.write('bye')


@action(summary='Counts the words', input='*text:String // Text to analyze', output='words:Number', mcp=True, timeout=5000)
def count(data):
    """Counts the words of a text."""
    return {'words': len(data['text'].split())}


@action
def bare(data):
    """Declared without arguments."""
    return 'bare'


@action(summary='Internal, not exposed to agents', input='value:Number')
async def double(data):
    return data['value'] * 2


@action(summary='Always fails', input='value:Number')
def explode(data):
    raise RuntimeError('secret internal detail')


@action(summary='Rejects the input', input='value:Number')
def reject(data):
    raise ValueError('value is not acceptable')


@action(summary='Streams numbers', input='n:Number')
def count_up(data):
    for i in range(data['n']):
        yield i


def undecorated(data):
    return 'callable but not registered'


def loaded(data):
    return dict(state)
