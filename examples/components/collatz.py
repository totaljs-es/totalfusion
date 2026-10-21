from totalfusion import action


@action(summary='Finds the number below the limit with the longest Collatz chain', input='*limit:Number // Exclusive upper bound')
def longest(data):
    best_number, best_steps = 1, 1

    for start in range(1, int(data['limit'])):
        n, steps = start, 1

        while n != 1:
            n = n // 2 if n % 2 == 0 else 3 * n + 1
            steps += 1

        if steps > best_steps:
            best_number, best_steps = start, steps

    return {'number': best_number, 'steps': best_steps}
