import os

import numpy as np
from sklearn.datasets import load_digits
from sklearn.ensemble import RandomForestClassifier

from totalfusion import action, startup

model = None
accuracy = None


@startup
def train():
    """A real model trained once per worker. A real component would load saved weights here."""
    global model, accuracy
    digits = load_digits()
    split = int(len(digits.data) * 0.8)
    model = RandomForestClassifier(n_estimators=300, random_state=0, n_jobs=1)
    model.fit(digits.data[:split], digits.target[:split])
    accuracy = float(model.score(digits.data[split:], digits.target[split:]))


@action(summary='Recognizes a handwritten digit from an 8x8 image (64 values from 0 to 16)', input='*pixels:[Number] // 64 values', output='digit:Number\nconfidence:Number', mcp=True)
def predict(data):
    pixels = np.asarray(data['pixels'], dtype=np.float64)

    if pixels.shape != (64,):
        raise ValueError('The image must have 64 values')

    probabilities = model.predict_proba(pixels.reshape(1, -1))[0]
    best = int(np.argmax(probabilities))
    return {'digit': int(model.classes_[best]), 'confidence': round(float(probabilities[best]), 3)}


def info(data):
    return {'pid': os.getpid(), 'accuracy': accuracy}
