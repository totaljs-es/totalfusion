// The worker that the test suite of TotalFusion runs. It has a function for every situation that matters.

use std::sync::Mutex;
use std::time::Duration;
use std::{fs, thread};

use totalfusion::{object, App, Call, Error, Value};

static HOG: Mutex<Vec<Vec<u8>>> = Mutex::new(Vec::new());

fn number(call: &Call, key: &str) -> Result<f64, Error> {
    call.args[key].as_f64().ok_or_else(|| Error::invalid(format!("{} must be a number", key)))
}

fn attempt(call: &Call) -> Result<u64, Error> {
    use std::io::Write;

    let path = call.args["marker"].as_str().ok_or_else(|| Error::invalid("marker must be a string"))?;
    fs::OpenOptions::new().create(true).append(true).open(path)?.write_all(b"x")?;
    Ok(fs::metadata(path)?.len())
}

fn main() {
    App::new()
        .function("math.add", |call: &Call| Ok(object! { "sum" => number(call, "a")? + number(call, "b")? }))
        .summary("Adds two numbers")
        .input("*a:Number\n*b:Number")
        .output("sum:Number")
        .mcp(true)
        .timeout(5000)
        .function("text.length", |call: &Call| {
            let text = call.args["text"].as_str().ok_or_else(|| Error::invalid("text must be a string"))?;
            Ok(object! { "length" => text.chars().count() })
        })
        .summary("Counts the characters")
        .input("*text:String")
        .output("length:Number")
        .function("echo", |call: &Call| Ok(call.args.clone()))
        .function("pid", |_call: &Call| Ok(std::process::id().into()))
        .function("exe", |_call: &Call| Ok(std::env::current_exe().map(|path| path.to_string_lossy().to_string()).unwrap_or_default().into()))
        .function("memory", |_call: &Call| Ok(totalfusion::memory().into()))
        // failures
        .function("fail", |_call: &Call| Err(Error::new("something failed")))
        .function("invalid", |_call: &Call| Err(Error::invalid("the value is not acceptable")))
        .function("named", |_call: &Call| Err(Error::named("DatabaseError", "no connection").with_code("E_DB")))
        .function("boom", |_call: &Call| -> Result<Value, Error> { panic!("kaboom") })
        .function("crash", |_call: &Call| -> Result<Value, Error> { std::process::exit(3) })
        .function("nan", |_call: &Call| Ok(Value::Float(f64::NAN)))
        .function("print", |_call: &Call| {
            println!("this goes to the error output, not to the protocol");
            Ok("ok".into())
        })
        // a function that checks if it was cancelled
        .function("sleep", |call: &Call| {
            let mut left = number(call, "ms")? as u64;

            while left > 0 {
                if call.is_cancelled() {
                    return Err(Error::new("stopped"));
                }
                thread::sleep(Duration::from_millis(10));
                left = left.saturating_sub(10);
            }

            Ok("done".into())
        })
        // a function that never looks at is_cancelled(): only killing the process stops it
        .function("deaf", |call: &Call| {
            thread::sleep(Duration::from_millis(number(call, "ms")? as u64));
            Ok("done".into())
        })
        // keeps its worker busy, then says which worker it was
        .function("slow_pid", |call: &Call| {
            thread::sleep(Duration::from_millis(number(call, "ms")? as u64));
            Ok(std::process::id().into())
        })
        // binary data
        .function("bytes.length", |call: &Call| Ok(call.args["blob"].as_bytes().map(|bytes| bytes.len()).ok_or_else(|| Error::invalid("blob must be a Buffer"))?.into()))
        .function("bytes.sum", |call: &Call| {
            let bytes = call.args["blob"].as_bytes().ok_or_else(|| Error::invalid("blob must be a Buffer"))?;
            Ok(bytes.iter().map(|byte| *byte as u64).sum::<u64>().into())
        })
        .function("bytes.make", |call: &Call| Ok(vec![7u8; number(call, "n")? as usize].into()))
        .function("floats.sum", |call: &Call| {
            let values = call.args["values"].as_f32s().ok_or_else(|| Error::invalid("values must be a Float32Array"))?;
            Ok(values.iter().map(|value| *value as f64).sum::<f64>().into())
        })
        .function("floats.double", |call: &Call| {
            let values = call.args["values"].as_f32s().ok_or_else(|| Error::invalid("values must be a Float32Array"))?;
            Ok(values.iter().map(|value| value * 2.0).collect::<Vec<f32>>().into())
        })
        .function("types", |_call: &Call| {
            Ok(object! {
                "i32" => vec![-1i32, 2],
                "f64" => vec![0.5f64, 1.5],
                "u16" => vec![65535u16],
                "i64" => vec![i64::MIN],
                "bytes" => vec![1u8, 2, 3],
                "nested" => Value::array([vec![1u8], vec![2u8, 3]]),
            })
        })
        // query and params
        .function("sections", |call: &Call| Ok(call.args.clone()))
        .summary("Shows what the worker receives")
        .input("a:Number")
        .query("*page:Number")
        .params("id:UID")
        .mcp(true)
        .function("restricted", |_call: &Call| Ok("allowed".into()))
        .permissions("admin,editor")
        // memory
        .function("leak", |call: &Call| {
            // touching every byte, otherwise the system does not give the memory
            HOG.lock().unwrap().push(vec![1u8; number(call, "mb")? as usize * 1024 * 1024]);
            Ok(HOG.lock().unwrap().len().into())
        })
        .function("held", |_call: &Call| Ok(HOG.lock().unwrap().len().into()))
        // streams
        .stream("count.up", |call: &Call| {
            let start = call.args["start"].as_i64().unwrap_or(0);

            for index in 0..call.args["n"].as_i64().unwrap_or(0) {
                call.emit(start + index)?;
            }

            Ok(())
        })
        .summary("Counts up")
        .stream("ticks", |call: &Call| {
            for index in 0..number(call, "n")? as i64 {
                thread::sleep(Duration::from_millis(number(call, "delay")? as u64));
                call.emit(object! { "tick" => index })?;
            }

            Ok(())
        })
        .stream("blobs", |call: &Call| {
            for index in 0..number(call, "n")? as u8 {
                call.emit(object! { "i" => index as i64, "blob" => vec![index; 1000] })?;
            }

            Ok(())
        })
        .stream("fails_midway", |call: &Call| {
            call.emit(1)?;
            call.emit(2)?;
            Err(Error::invalid("boom after two chunks"))
        })
        .stream("crash_midway", |call: &Call| {
            call.emit("first")?;
            std::process::exit(3)
        })
        .stream("endless", |call: &Call| {
            // writes how far it got, so the test can see the backpressure
            let file = call.args["file"].as_str().unwrap_or("").to_string();
            let mut index = 0i64;

            loop {
                if !file.is_empty() {
                    let _ = fs::write(format!("{}.tmp", file), index.to_string()).and_then(|_| fs::rename(format!("{}.tmp", file), &file));
                }

                call.emit(index)?;
                index += 1;
            }
        })
        .function("actions.fails", |_call: &Call| -> Result<Value, Error> { Err(Error::new("password of the database: secret")) })
        .action()
        .function("actions.rejects", |_call: &Call| -> Result<Value, Error> { Err(Error::invalid("the value is not acceptable")) })
        .action()
        // each attempt leaves a byte in a file, even if the process dies
        .function("flaky.crash_first", |call: &Call| {
            if attempt(call)? == 1 {
                std::process::exit(3);
            }
            Ok("ok".into())
        })
        .function("flaky.crash_always", |call: &Call| -> Result<Value, Error> {
            attempt(call)?;
            std::process::exit(3)
        })
        .function("flaky.counted", |call: &Call| Ok(fs::metadata(call.args["marker"].as_str().unwrap_or("")).map(|meta| meta.len()).unwrap_or(0).into()))
        .function("single", |_call: &Call| Ok("single".into()))
        .action()
        .on_shutdown(|| {
            if let Ok(path) = std::env::var("FUSION_TEST_SHUTDOWN_FILE") {
                let _ = fs::write(path, "bye");
            }
        })
        .run();
}
