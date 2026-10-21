import time
from totalfusion import action, startup


@startup
def load_model():
    time.sleep(0.8)


@action(input='a:Number')
def add_one(data):
    return data['a'] + 1
