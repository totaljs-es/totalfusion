from totalfusion import action, startup

# Importing this module would fail (and, in real life, load a huge model).
# Describing it must not import it.
raise RuntimeError('this module must never be imported by describe()')


@startup
def load():
    pass


@action(summary='Needs a model', input='*text:String')
def classify(data):
    return 'x'


LABEL = 'dynamic'


@action(summary=LABEL)
def not_literal(data):
    return 'x'
