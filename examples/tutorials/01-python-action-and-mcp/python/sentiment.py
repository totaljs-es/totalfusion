from totalfusion import action

POSITIVE = {'love', 'great', 'good', 'excellent', 'happy', 'amazing', 'fast', 'works'}
NEGATIVE = {'hate', 'bad', 'terrible', 'awful', 'slow', 'broken', 'sad', 'fails'}


@action(
    summary='Detects whether a text is positive, negative or neutral',
    input='*text:String // The text to read',
    output='label:String\nscore:Number',
    mcp=True
)
def analyze(data):
    words = [word.strip('.,;:!?"\'()').lower() for word in data['text'].split()]
    score = sum(word in POSITIVE for word in words) - sum(word in NEGATIVE for word in words)

    return {
        'label': 'POSITIVE' if score > 0 else 'NEGATIVE' if score < 0 else 'NEUTRAL',
        'score': score
    }
