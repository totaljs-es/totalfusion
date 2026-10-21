use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{self, Write};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;

use serde_json::json;

use crate::error::Error;
use crate::memory;
use crate::value::{from_json, to_json, Value};
use crate::wire::{read_frame, write_frame, VERSION};

type FunctionHandler = Arc<dyn Fn(&Call) -> Result<Value, Error> + Send + Sync + 'static>;
type StreamHandler = Arc<dyn Fn(&Call) -> Result<(), Error> + Send + Sync + 'static>;

enum Handler {
    Function(FunctionHandler),
    Stream(StreamHandler),
}

struct Registered {
    name: String,
    handler: Handler,
    meta: BTreeMap<String, Value>,
    /// Registered as an action of Total.js: the function declared its contract or asked for it
    action: bool,
}

/// The functions of your worker. Build it, register the functions and call [`App::run`].
///
/// ```no_run
/// use totalfusion::{object, App, Call, Error, Value};
///
/// fn main() {
///     App::new()
///         .function("math.add", |call: &Call| {
///             let a = call.args["a"].as_f64().ok_or_else(|| Error::invalid("a must be a number"))?;
///             let b = call.args["b"].as_f64().ok_or_else(|| Error::invalid("b must be a number"))?;
///             Ok(object! { "sum" => a + b })
///         })
///         .summary("Adds two numbers")
///         .input("*a:Number\n*b:Number")
///         .output("sum:Number")
///         .mcp(true)
///         .run();
/// }
/// ```
///
/// The methods that describe a function (`summary`, `input`, `output`, `mcp`, ...) apply to the function that was
/// registered just before them. They are the contract that Total.js uses to create the action and the MCP tool.
pub struct App {
    functions: Vec<Registered>,
    on_shutdown: Vec<Box<dyn Fn() + Send + Sync>>,
}

impl Default for App {
    fn default() -> App {
        App::new()
    }
}

impl App {
    pub fn new() -> App {
        App { functions: Vec::new(), on_shutdown: Vec::new() }
    }

    /// A function that answers once. In JavaScript: `fusion.rust('name', args)`.
    pub fn function<F>(mut self, name: &str, handler: F) -> App
    where
        F: Fn(&Call) -> Result<Value, Error> + Send + Sync + 'static,
    {
        self.functions.push(Registered { name: name.to_string(), handler: Handler::Function(Arc::new(handler)), meta: BTreeMap::new(), action: false });
        self
    }

    /// A function that sends many chunks with [`Call::emit`]. In JavaScript: `fusion.rust.stream('name', args)`.
    pub fn stream<F>(mut self, name: &str, handler: F) -> App
    where
        F: Fn(&Call) -> Result<(), Error> + Send + Sync + 'static,
    {
        self.functions.push(Registered { name: name.to_string(), handler: Handler::Stream(Arc::new(handler)), meta: BTreeMap::new(), action: false });
        self
    }

    /// Runs when the worker is asked to stop, and when Node.js goes away.
    pub fn on_shutdown<F: Fn() + Send + Sync + 'static>(mut self, handler: F) -> App {
        self.on_shutdown.push(Box::new(handler));
        self
    }

    fn set(mut self, key: &str, value: Value) -> App {
        let function = self.functions.last_mut().expect("register a function before describing it");
        function.meta.insert(key.to_string(), value);
        function.action = true;
        self
    }

    /// Registers the function as an action of Total.js (and a FlowStream or MCP tool, if it says so) even when it
    /// declares nothing else. A function that declares any part of its contract (`summary`, `input`, ...) is
    /// registered too; the ones that declare nothing can still be called from JavaScript, but they stay private.
    pub fn action(mut self) -> App {
        self.functions.last_mut().expect("register a function before describing it").action = true;
        self
    }

    /// One line for people and for the MCP tool.
    pub fn summary(self, text: &str) -> App {
        self.set("summary", text.into())
    }

    /// The contract of the input, in the schema syntax of Total.js: `"*name:String\nage:Number"`. `*` means required.
    pub fn input(self, schema: &str) -> App {
        self.set("input", schema.into())
    }

    pub fn output(self, schema: &str) -> App {
        self.set("output", schema.into())
    }

    /// With `query` or `params` declared, the function receives `{ input, query, params }` instead of the input alone.
    pub fn query(self, schema: &str) -> App {
        self.set("query", schema.into())
    }

    pub fn params(self, schema: &str) -> App {
        self.set("params", schema.into())
    }

    /// Expose the function to AI agents as an MCP tool. Off unless you say so.
    pub fn mcp(self, value: bool) -> App {
        self.set("mcp", value.into())
    }

    /// Who may call: `"admin,editor"`, any of them.
    pub fn permissions(self, permissions: &str) -> App {
        self.set("permissions", permissions.into())
    }

    /// Only a logged in user (`true`) or only an anonymous one (`false`).
    pub fn user(self, value: bool) -> App {
        self.set("user", value.into())
    }

    pub fn sa(self, value: bool) -> App {
        self.set("sa", value.into())
    }

    pub fn su(self, value: bool) -> App {
        self.set("su", value.into())
    }

    /// Longest time of a call, in milliseconds.
    pub fn timeout(self, milliseconds: u64) -> App {
        self.set("timeout", milliseconds.into())
    }

    /// The name of the action in Total.js, if it should not be `module/function`.
    pub fn id(self, id: &str) -> App {
        self.set("id", id.into())
    }

    fn duplicates(&self) -> Vec<&str> {
        let mut seen = HashSet::new();
        self.functions.iter().filter(|function| !seen.insert(function.name.as_str())).map(|function| function.name.as_str()).collect()
    }

    /// The contracts, as `fusion.describe('rust')` and `register()` read them.
    fn describe(&self) -> serde_json::Value {
        let mut actions = Vec::new();
        let mut errors = Vec::new();

        for name in self.duplicates() {
            errors.push(json!({ "module": "", "function": name, "message": "The function is registered more than once" }));
        }

        for function in self.functions.iter().filter(|function| function.action) {
            let (module, name) = match function.name.rfind('.') {
                Some(index) => (&function.name[..index], &function.name[index + 1..]),
                None => ("", function.name.as_str()),
            };

            let mut meta = serde_json::Map::new();

            for (key, value) in &function.meta {
                meta.insert(key.clone(), to_json(value, &mut Vec::new()).unwrap_or(serde_json::Value::Null));
            }

            actions.push(json!({
                "fn": function.name,
                "module": module,
                "name": name,
                "async": false,
                "stream": matches!(function.handler, Handler::Stream(_)),
                "doc": null,
                "meta": meta,
            }));
        }

        json!({ "actions": actions, "functions": self.functions.len(), "startups": [], "errors": errors, "runtime": "rust", "protocol": VERSION, "sdk": env!("CARGO_PKG_VERSION") })
    }

    /// Starts the worker: it talks to Node.js through the standard input and output until Node.js closes them or asks it to stop.
    ///
    /// With `--describe` it prints its contracts and exits. Anything you do before `run()` (loading a model, opening
    /// a connection) happens before the worker tells Node.js that it is ready.
    pub fn run(self) -> ! {
        if std::env::args().any(|argument| argument == "--describe") {
            println!("{}", self.describe());
            std::process::exit(0);
        }

        let duplicates = self.duplicates();

        if !duplicates.is_empty() {
            eprintln!("totalfusion: the function \"{}\" is registered more than once", duplicates[0]);
            std::process::exit(1);
        }

        let writer = Arc::new(Writer { out: Mutex::new(protocol_output()) });
        writer.send(&json!({ "t": "ready", "v": VERSION, "pid": std::process::id(), "runtime": "rust", "sdk": env!("CARGO_PKG_VERSION") }), &[]);

        let app = Arc::new(self);
        let calls: Arc<Mutex<HashMap<u64, Arc<Shared>>>> = Arc::new(Mutex::new(HashMap::new()));
        let stdin = io::stdin();
        let mut reader = stdin.lock();

        while let Ok(Some(frame)) = read_frame(&mut reader) {
            let message = &frame.json;

            match message["t"].as_str() {
                Some("call") => {
                    let parts = frame.parts();
                    let args = from_json(&message["args"], &parts);
                    start(&app, &writer, &calls, message["id"].as_u64().unwrap_or(0), message["fn"].as_str().unwrap_or(""), args, message["stream"].as_bool().unwrap_or(false), message["credit"].as_i64().unwrap_or(0));
                }
                Some("credit") => {
                    if let Some(shared) = lock(&calls).get(&message["id"].as_u64().unwrap_or(0)) {
                        shared.add_credit(message["n"].as_i64().unwrap_or(1));
                    }
                }
                Some("cancel") => {
                    if let Some(shared) = lock(&calls).get(&message["id"].as_u64().unwrap_or(0)) {
                        shared.cancel();
                    }
                }
                Some("ping") => writer.send(&json!({ "t": "pong", "id": message["id"], "mem": memory::current() }), &[]),
                Some("bye") => break,
                _ => {}
            }
        }

        // Node.js asked to stop, or it went away
        for shared in lock(&calls).values() {
            shared.cancel();
        }

        for handler in &app.on_shutdown {
            let _ = catch_unwind(AssertUnwindSafe(|| handler()));
        }

        std::process::exit(0);
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn start(app: &Arc<App>, writer: &Arc<Writer>, calls: &Arc<Mutex<HashMap<u64, Arc<Shared>>>>, id: u64, name: &str, args: Value, stream: bool, credit: i64) {
    let index = match app.functions.iter().position(|function| function.name == name) {
        Some(index) => index,
        None => return finish(writer, id, Err(Error::not_found(format!("Function \"{}\" not found", name)))),
    };

    if stream_only(&app.functions[index]) && !stream {
        let error = Error::named("TypeError", format!("The function \"{}\" is a stream: call it with fusion.stream()", name)).with_code("STREAMING_FUNCTION");
        return finish(writer, id, Err(error));
    }

    let shared = Arc::new(Shared { cancelled: AtomicBool::new(false), credit: Mutex::new(credit), wake: Condvar::new() });
    lock(calls).insert(id, shared.clone());

    let call = Call { args, id, shared, writer: writer.clone() };
    let (app, writer, calls) = (app.clone(), writer.clone(), calls.clone());

    thread::spawn(move || {
        let function = &app.functions[index];

        // A panic is a failure of this call, not of the worker
        let outcome = catch_unwind(AssertUnwindSafe(|| match &function.handler {
            Handler::Function(handler) => {
                let value = handler(&call)?;

                if stream {
                    // A normal function called as a stream is a stream of one chunk
                    call.emit(value)?;
                    Ok(Value::Null)
                } else {
                    Ok(value)
                }
            }
            Handler::Stream(handler) => handler(&call).map(|_| Value::Null),
        }));

        let result = outcome.unwrap_or_else(|panic| {
            let message = panic.downcast_ref::<&str>().map(|text| text.to_string()).or_else(|| panic.downcast_ref::<String>().cloned()).unwrap_or_else(|| "panic".to_string());
            Err(Error::named("Panic", message))
        });

        lock(&calls).remove(&id);
        finish(&writer, id, result);
    });
}

fn stream_only(function: &Registered) -> bool {
    matches!(function.handler, Handler::Stream(_))
}

fn finish(writer: &Writer, id: u64, result: Result<Value, Error>) {
    let mem = memory::current();

    let error = match result {
        Ok(value) => {
            let mut parts = Vec::new();

            match to_json(&value, &mut parts) {
                Ok(data) => return writer.send(&json!({ "t": "res", "id": id, "ok": true, "data": data, "mem": mem }), &parts),
                Err(error) => error,
            }
        }
        Err(error) => error,
    };

    writer.send(&json!({ "t": "res", "id": id, "ok": false, "error": { "name": error.name, "message": error.message, "code": error.code }, "mem": mem }), &[]);
}

/// What the function is told about the call, and what it uses to answer a stream.
pub struct Call {
    /// The arguments, as Node.js sent them.
    pub args: Value,
    id: u64,
    shared: Arc<Shared>,
    writer: Arc<Writer>,
}

impl Call {
    /// True when Node.js gave up on this call (timeout, abort). A long function should look at it from time to time and stop.
    pub fn is_cancelled(&self) -> bool {
        self.shared.cancelled.load(Ordering::SeqCst)
    }

    /// Sends a chunk of a stream. It waits when the consumer is slow (that is the backpressure) and fails with a
    /// cancelled error when it stops reading: use `?` and the stream ends.
    pub fn emit(&self, value: impl Into<Value>) -> Result<(), Error> {
        let value = value.into();

        {
            let mut credit = lock(&self.shared.credit);

            while *credit <= 0 && !self.is_cancelled() {
                credit = self.shared.wake.wait(credit).unwrap_or_else(|poisoned| poisoned.into_inner());
            }

            if self.is_cancelled() {
                return Err(Error::cancelled());
            }

            *credit -= 1;
        }

        let mut parts = Vec::new();
        let data = to_json(&value, &mut parts)?;
        self.writer.send(&json!({ "t": "chunk", "id": self.id, "data": data }), &parts);
        Ok(())
    }
}

struct Shared {
    cancelled: AtomicBool,
    credit: Mutex<i64>,
    wake: Condvar,
}

impl Shared {
    fn add_credit(&self, amount: i64) {
        *lock(&self.credit) += amount;
        self.wake.notify_all();
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        let _guard = lock(&self.credit);
        self.wake.notify_all();
    }
}

struct Writer {
    out: Mutex<Box<dyn Write + Send>>,
}

impl Writer {
    fn send(&self, json: &serde_json::Value, parts: &[Vec<u8>]) {
        // If Node.js is gone nobody reads the answer: the worker is done
        if write_frame(&mut *lock(&self.out), json, parts).is_err() {
            std::process::exit(0);
        }
    }
}

/// The real standard output belongs to the protocol. Everything that prints (println!, a library) goes to the error
/// output instead, where Node.js shows it, so it can never break a frame.
#[cfg(unix)]
fn protocol_output() -> Box<dyn Write + Send> {
    use std::os::unix::io::FromRawFd;

    extern "C" {
        fn dup(fd: i32) -> i32;
        fn dup2(from: i32, to: i32) -> i32;
    }

    unsafe {
        let protocol = dup(1);
        dup2(2, 1);
        Box::new(std::fs::File::from_raw_fd(protocol))
    }
}

/// On Windows the standard output is not redirected: do not print to it (use `eprintln!`).
#[cfg(not(unix))]
fn protocol_output() -> Box<dyn Write + Send> {
    Box::new(io::stdout())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_contracts_are_described_like_the_python_worker_does() {
        let app = App::new()
            .function("math.add", |_call: &Call| Ok(Value::Null))
            .summary("Adds")
            .input("*a:Number")
            .mcp(true)
            .timeout(5000)
            .stream("count.up", |_call: &Call| Ok(()))
            .action()
            .function("ping", |_call: &Call| Ok(Value::Null))
            .action()
            .function("internal.helper", |_call: &Call| Ok(Value::Null));

        let described = app.describe();
        let actions = described["actions"].as_array().unwrap();

        // the one that declares nothing stays private, but it is counted
        assert_eq!(actions.len(), 3);
        assert_eq!(described["functions"], 4);
        assert_eq!(actions[0]["fn"], "math.add");
        assert_eq!(actions[0]["module"], "math");
        assert_eq!(actions[0]["name"], "add");
        assert_eq!(actions[0]["stream"], false);
        assert_eq!(actions[0]["meta"]["summary"], "Adds");
        assert_eq!(actions[0]["meta"]["input"], "*a:Number");
        assert_eq!(actions[0]["meta"]["mcp"], true);
        assert_eq!(actions[0]["meta"]["timeout"], 5000);
        assert_eq!(actions[1]["stream"], true);
        assert_eq!(actions[2]["module"], "");
        assert_eq!(actions[2]["name"], "ping");
        assert_eq!(described["protocol"], 2);
    }

    #[test]
    fn declaring_any_part_of_the_contract_registers_the_function() {
        let app = App::new().function("a", |_call: &Call| Ok(Value::Null)).mcp(false).function("b", |_call: &Call| Ok(Value::Null)).function("c", |_call: &Call| Ok(Value::Null)).action();
        let names: Vec<String> = app.describe()["actions"].as_array().unwrap().iter().map(|action| action["fn"].as_str().unwrap().to_string()).collect();
        assert_eq!(names, vec!["a", "c"]);
    }

    #[test]
    fn a_function_registered_twice_is_reported() {
        let app = App::new().function("a", |_call: &Call| Ok(Value::Null)).function("a", |_call: &Call| Ok(Value::Null));
        assert_eq!(app.duplicates(), vec!["a"]);
        assert_eq!(app.describe()["errors"].as_array().unwrap().len(), 1);
    }

    #[test]
    #[should_panic(expected = "register a function before describing it")]
    fn describing_without_a_function_is_a_mistake() {
        let _ = App::new().summary("nothing to describe");
    }
}
