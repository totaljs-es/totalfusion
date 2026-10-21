//! The memory of this process in bytes, or `None` when the system does not allow to know it.
//!
//! Linux: resident set size. macOS: physical footprint (what Activity Monitor shows, compressed memory included).
//! Windows: the private bytes of the process.

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

#[cfg(windows)]
pub fn current() -> Option<u64> {
    // PROCESS_MEMORY_COUNTERS_EX: PrivateUsage is the memory that only this process uses (what Task Manager calls "Memory")
    #[repr(C)]
    struct Counters {
        cb: u32,
        page_fault_count: u32,
        peak_working_set_size: usize,
        working_set_size: usize,
        quota_peak_paged_pool_usage: usize,
        quota_paged_pool_usage: usize,
        quota_peak_non_paged_pool_usage: usize,
        quota_non_paged_pool_usage: usize,
        pagefile_usage: usize,
        peak_pagefile_usage: usize,
        private_usage: usize,
    }

    extern "system" {
        fn GetCurrentProcess() -> isize;
        fn K32GetProcessMemoryInfo(process: isize, counters: *mut Counters, size: u32) -> i32;
    }

    let mut counters = Counters {
        cb: std::mem::size_of::<Counters>() as u32,
        page_fault_count: 0,
        peak_working_set_size: 0,
        working_set_size: 0,
        quota_peak_paged_pool_usage: 0,
        quota_paged_pool_usage: 0,
        quota_peak_non_paged_pool_usage: 0,
        quota_non_paged_pool_usage: 0,
        pagefile_usage: 0,
        peak_pagefile_usage: 0,
        private_usage: 0,
    };

    if unsafe { K32GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, counters.cb) } != 0 {
        Some(counters.private_usage as u64)
    } else {
        None
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
pub fn current() -> Option<u64> {
    None
}
