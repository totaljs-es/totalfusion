use std::fmt;

/// What a function reports when it fails. It reaches JavaScript as an error with the same `name`, `message`
/// and `code`, so `name` should say what kind of failure it is.
///
/// Use [`Error::invalid`] for a mistake of the caller (bad input): Total.js sends its message to the client.
/// Any other failure stays in the log of the server and the client only learns that the action failed.
#[derive(Debug, Clone, PartialEq)]
pub struct Error {
    pub name: String,
    pub message: String,
    pub code: Option<String>,
}

impl Error {
    /// A failure of the function.
    pub fn new(message: impl Into<String>) -> Error {
        Error { name: "Error".to_string(), message: message.into(), code: None }
    }

    /// A mistake of the caller: the input is not valid.
    pub fn invalid(message: impl Into<String>) -> Error {
        Error { name: "ValueError".to_string(), message: message.into(), code: None }
    }

    /// A failure with a name of your own.
    pub fn named(name: impl Into<String>, message: impl Into<String>) -> Error {
        Error { name: name.into(), message: message.into(), code: None }
    }

    pub fn with_code(mut self, code: impl Into<String>) -> Error {
        self.code = Some(code.into());
        self
    }

    pub(crate) fn cancelled() -> Error {
        Error { name: "Cancelled".to_string(), message: "The call was cancelled".to_string(), code: Some("CANCELLED".to_string()) }
    }

    pub(crate) fn not_serializable(message: impl Into<String>) -> Error {
        Error { name: "TypeError".to_string(), message: message.into(), code: Some("NOT_SERIALIZABLE".to_string()) }
    }

    pub(crate) fn not_found(message: impl Into<String>) -> Error {
        Error { name: "LookupError".to_string(), message: message.into(), code: Some("NOT_FOUND".to_string()) }
    }

    /// True when the call was cancelled by Node.js: a stream should simply stop.
    pub fn is_cancelled(&self) -> bool {
        self.code.as_deref() == Some("CANCELLED")
    }
}

impl fmt::Display for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.name, self.message)
    }
}

impl std::error::Error for Error {}

impl From<&str> for Error {
    fn from(message: &str) -> Error {
        Error::new(message)
    }
}

impl From<String> for Error {
    fn from(message: String) -> Error {
        Error::new(message)
    }
}

impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Error {
        Error::named("IoError", error.to_string())
    }
}

impl From<std::num::ParseIntError> for Error {
    fn from(error: std::num::ParseIntError) -> Error {
        Error::invalid(error.to_string())
    }
}

impl From<std::num::ParseFloatError> for Error {
    fn from(error: std::num::ParseFloatError) -> Error {
        Error::invalid(error.to_string())
    }
}
