from threading import Thread

from totalfusion import startup

MODEL = 'distilbert/distilgpt2'
tokenizer = None
model = None


@startup
def load():
    global tokenizer, model
    from transformers import AutoModelForCausalLM, AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(MODEL)
    model = AutoModelForCausalLM.from_pretrained(MODEL)
    model.eval()


def generate(data):
    """Streams the text token by token. It is a generator, so call it with fusion.stream()."""

    import torch
    from transformers import StoppingCriteria, StoppingCriteriaList, TextIteratorStreamer

    class Stop(StoppingCriteria):
        """Lets the consumer stop the generation: leaving the loop in Node.js closes this generator."""
        stopped = False

        def __call__(self, input_ids, scores, **kwargs):
            return torch.full((input_ids.shape[0],), self.stopped, dtype=torch.bool, device=input_ids.device)

    stop = Stop()
    inputs = tokenizer(data['prompt'], return_tensors='pt')
    streamer = TextIteratorStreamer(tokenizer, skip_prompt=True)

    thread = Thread(target=model.generate, kwargs=dict(
        **inputs,
        streamer=streamer,
        max_new_tokens=int(data.get('tokens') or 40),
        do_sample=False,
        pad_token_id=tokenizer.eos_token_id,
        stopping_criteria=StoppingCriteriaList([stop])
    ))

    thread.start()

    try:
        for text in streamer:
            if text:
                yield text
    finally:
        stop.stopped = True
        thread.join()
