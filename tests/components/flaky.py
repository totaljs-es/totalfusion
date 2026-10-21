import os

from totalfusion import action


def attempt(data):
    """Counts how many times the function has run, even if the process dies: one byte per attempt in a file."""
    with open(data['marker'], 'a') as f:
        f.write('x')
    return os.path.getsize(data['marker'])


def crash_first(data):
    if attempt(data) == 1:
        os._exit(3)
    return 'ok'


def crash_always(data):
    attempt(data)
    os._exit(3)


def fails(data):
    attempt(data)
    raise RuntimeError('a failure of the function itself')


def hangs(data):
    attempt(data)
    import time
    time.sleep(30)


@action(summary='Crashes the first time it runs', input='*marker:String', idempotent=True)
def contract_flaky(data):
    return 'ok' if attempt(data) > 1 else os._exit(3)


def counted(data):
    return os.path.getsize(data['marker']) if os.path.exists(data['marker']) else 0
