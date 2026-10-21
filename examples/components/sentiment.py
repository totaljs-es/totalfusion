import os

from totalfusion import action, startup

MODEL = 'distilbert/distilbert-base-uncased-finetuned-sst-2-english'

# One fixed input shape: torch on CPU prepares its kernels per tensor shape, and every new
# sequence length costs 100-250 ms the first time. Padding to a fixed length pays it once, at startup.
# The price: only the first 64 tokens of a text are analyzed.
PAD = {'padding': 'max_length', 'max_length': 64, 'truncation': True}
pipe = None


@startup
def load():
    """Loads the model once per worker. The weights are cached on disk after the first download."""
    global pipe
    from transformers import pipeline
    pipe = pipeline('sentiment-analysis', model=MODEL)
    pipe('warm up', **PAD)


@action(summary='Detects the sentiment (POSITIVE or NEGATIVE) of an English text', input='*text:String // Text to analyze (up to 2000 characters)', output='label:String\nscore:Number', mcp=True)
def analyze(data):
    text = data['text'][:2000]

    if not text.strip():
        raise ValueError('The text is empty')

    result = pipe(text, **PAD)[0]
    return {'label': result['label'], 'score': round(result['score'], 4)}


def info(data):
    import torch
    return {'pid': os.getpid(), 'threads': torch.get_num_threads()}
