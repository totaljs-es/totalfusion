//! The memory of this process in bytes, or `None` when the system does not allow to know it.
//!
//! Linux: resident set size. macOS: physical footprint (what Activity Monitor shows, compressed memory included).

#[cfg(target_os = "linux")]
pub fn current() -> Option<u64> {
    extern "C" {
        fn sysconf(name: i32) -> i64;
    }

    // _SC_PAGESIZE
    let page = unsafe { sysconf(30) };
    let statm = std::fs::read_to_string("/proc/self/statm").ok()?;
    let resident: u64 = statm.split_whitespace().nth(1)?.parse().ok()?;

    if page > 0 {
        Some(resident * page as u64)
    } else {
        None
    }
}

#[cfg(target_os = "macos")]
pub fn current() -> Option<u64> {
    extern "C" {
        fn getpid() -> i32;
        fn proc_pid_rusage(pid: i32, flavor: i32, buffer: *mut u64) -> i32;
    }

    // struct rusage_info_v0: the physical footprint is the 10th field of 64 bits
    let mut info = [0u64; 20];

    if unsafe { proc_pid_rusage(getpid(), 0, info.as_mut_ptr()) } == 0 {
        Some(info[9])
    } else {
        None
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
pub fn current() -> Option<u64> {
    None
}
