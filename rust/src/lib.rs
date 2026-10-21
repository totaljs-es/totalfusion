//! The Rust side of TotalFusion: write functions in Rust and call them from Node.js and Total.js as `async` functions.
//!
//! A worker is a normal binary. It registers its functions and calls [`App::run`]; Node.js starts it, keeps a pool of
//! them, and talks to it through the standard input and output. A crash in Rust never takes Node.js down.
//!
//! ```no_run
//! use totalfusion::{object, App, Call, Error};
//!
//! fn main() {
//!     App::new()
//!         .function("text.length", |call: &Call| {
//!             let text = call.args["text"].as_str().ok_or_else(|| Error::invalid("text must be a string"))?;
//!             Ok(object! { "length" => text.chars().count() })
//!         })
//!         .input("*text:String")
//!         .output("length:Number")
//!         .mcp(true)
//!         .run();
//! }
//! ```
//!
//! ```js
//! const result = await fusion.rust('text.length', { text: 'Hello' });   // { length: 5 }
//! ```
//!
//! Do not print to the standard output of a worker: it carries the protocol. On Unix the SDK redirects it to the error
//! output for you; use `eprintln!` to be safe everywhere.

mod app;
mod error;
mod memory;
mod value;
mod wire;

pub use app::{App, Call};
pub use error::Error;
pub use memory::current as memory;
pub use value::Value;
