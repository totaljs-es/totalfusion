use totalfusion::{object, App, Call, Error};

/// The number below `limit` with the longest Collatz chain, and the length of that chain.
fn collatz(limit: u64) -> (u64, u32) {
    let mut best = (1, 1);

    for start in 1..limit {
        let (mut n, mut steps) = (start, 1u32);

        while n != 1 {
            n = if n % 2 == 0 { n / 2 } else { 3 * n + 1 };
            steps += 1;
        }

        if steps > best.1 {
            best = (start, steps);
        }
    }

    best
}

fn main() {
    App::new()
        .function("collatz.longest", |call: &Call| {
            let limit = call.args["limit"].as_i64().filter(|limit| *limit > 1).ok_or_else(|| Error::invalid("limit must be a number greater than 1"))? as u64;
            let (number, steps) = collatz(limit);
            Ok(object! { "number" => number, "steps" => steps })
        })
        .summary("Finds the number below the limit with the longest Collatz chain")
        .input("*limit:Number // Exclusive upper bound (up to a few million)")
        .output("number:Number\nsteps:Number")
        .mcp(true)
        .timeout(60000)
        .run();
}
