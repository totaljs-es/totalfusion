import numpy as np
from totalfusion import action, startup

# Loaded once per worker. A real component would load a model here instead.
index = None


@startup
def build_index():
    global index
    rng = np.random.default_rng(42)
    index = rng.standard_normal((50000, 128)).astype(np.float32)
    index /= np.linalg.norm(index, axis=1, keepdims=True)


@action(summary='Finds the closest vectors of the index (cosine similarity)', input='*vector:[Number] // Query vector (128 numbers)\ntop:Number // Results to return', mcp=True)
def nearest(data):
    query = np.asarray(data['vector'], dtype=np.float32)

    if query.shape != (128,):
        raise ValueError('The vector must have 128 numbers')

    query /= np.linalg.norm(query)
    scores = index @ query
    best = np.argsort(-scores)[:int(data.get('top') or 5)]
    return [{'id': int(i), 'score': round(float(scores[i]), 4)} for i in best]
