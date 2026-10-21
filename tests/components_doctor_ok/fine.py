import json
import os

from totalfusion import action


@action(summary='Everything this imports is in the standard library', input='value:Number')
def double(data):
    return json.loads(str(data['value'] * 2)) + len(os.sep) - 1


def numbers(data):
    yield 1
