from totalfusion import action

LABEL = 'built at runtime'


@action(summary=LABEL)
def thing(data):
    return 1
