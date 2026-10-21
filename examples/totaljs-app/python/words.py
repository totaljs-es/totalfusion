import time

from totalfusion import action


@action(summary='Counts the words of a text and finds the longest one', input='*text:String // Text to analyze', output='words:Number\nlongest:String', mcp=True)
def analyze(data):
    words = data['text'].split()
    return {'words': len(words), 'longest': max(words, key=len) if words else ''}


@action(summary='Shows how query and params arrive', input='note:String', query='*page:Number', params='id:String')
def inspect(data):
    return data


# A function that yields is a stream: it is not an action, it is read with fusion.stream() or fusion.sse()
def countdown(data):
    for number in range(int(data['from']), 0, -1):
        time.sleep(0.4)
        yield {'number': number}
