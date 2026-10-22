import numpy as np
from totalfusion import action


def values_of(data):
    values = np.asarray(data['values'], dtype=np.float64)
    if values.ndim != 1 or not values.size or not np.isfinite(values).all():
        raise ValueError('Send a non-empty list of finite numbers')
    return values


@action(summary='Summarizes a list of numbers with NumPy', input='*values:[Number]', output='count:Number\nmean:Number\nstd:Number\nmin:Number\nmax:Number', mcp=True)
def summarize(data):
    values = values_of(data)
    return {
        'count': int(values.size),
        'mean': float(values.mean()),
        'std': float(values.std()),
        'min': float(values.min()),
        'max': float(values.max()),
    }


# The memoryview received from JavaScript exposes the Float32Array bytes directly.
# This function has no action contract: the Total.js action below handles JSON at the HTTP boundary.
def normalize(data):
    values = np.frombuffer(data['values'], dtype=np.float32)
    if not values.size or not np.isfinite(values).all():
        raise ValueError('Send a non-empty list of finite Float32 numbers')
    deviation = float(values.std())
    if not np.isfinite(deviation) or deviation == 0:
        raise ValueError('The standard deviation must be finite and greater than zero')
    return (values - values.mean()) / deviation
