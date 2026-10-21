"""TotalFusion SDK for Python components. Standard library only.

    from totalfusion import action, startup, shutdown

    model = None

    @startup
    def load():
        global model
        model = load_my_model()

    @action(summary='Counts the words', input='*text:String // Text to analyze', output='words:Number', mcp=True)
    def count(data):
        return { 'words': len(data['text'].split()) }

The decorators only mark the functions. The arguments of `action()` are read
statically (they must be literals), so describing a component never imports it.
"""


def _mark(fn, attribute, value):
    setattr(fn, attribute, value)
    return fn


def action(*args, **meta):
    """Declares the contract of a function: summary, input, output, mcp, permissions, timeout, name."""

    if len(args) == 1 and callable(args[0]) and not meta:
        return _mark(args[0], '__fusion__', {})

    return lambda fn: _mark(fn, '__fusion__', meta)


def startup(fn):
    """Runs once per worker, right after its module is imported (sync or async)."""
    return _mark(fn, '__fusion_startup__', True)


def shutdown(fn):
    """Runs once when the worker stops gracefully (sync or async, 1.5 s at most)."""
    return _mark(fn, '__fusion_shutdown__', True)
