def analyze(data):
    words = data['text'].split()
    return {
        'success': True,
        'words': len(words),
        'longest': max(words, key=len) if words else None
    }
