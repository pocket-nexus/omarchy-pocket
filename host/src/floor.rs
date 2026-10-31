//! Clock floors while the user is working. Two governors on the RK3568 run
//! the shell at their lowest clock through a single frame of guest work: the
//! CPU's schedutil (408 MHz to 1.99 GHz, one 60 Hz tick of QuickJS never
//! raises its utilization) and the Mali-G52's simple_ondemand (200 MHz,
//! sampled every 50 ms, where a panel takes about 15 ms to render against 4
//! at 800 MHz). Each floor writes the governor's `min_freq` instead: up to
//! the highest clock when input arrives or a frame is presented, down to the
//! lowest after IDLE without either. tmpfiles.d rules give the video group
//! the files; where a write is refused the floor leaves that governor alone.
//!
//! Input is seen before the runtime samples it: the probe keeps a second
//! handle on every evdev device and polls them for readiness at the top of
//! each tick, so the clocks are up before the guest work the input causes.
use std::{
    fs::File,
    io::Read,
    os::fd::AsRawFd,
    path::Path,
    time::{Duration, Instant},
};

const IDLE: Duration = Duration::from_secs(2);
const GPU_DEVFREQ: &str = "/sys/class/devfreq/fde60000.gpu";
const CPU_POLICY: &str = "/sys/devices/system/cpu/cpufreq/policy0";

struct Floor {
    name: &'static str,
    path: String,
    low: u64,
    high: u64,
    raised: bool,
    broken: bool,
}

impl Floor {
    /// `dir` holds `min_freq` and a list of frequencies under `list`.
    fn new(name: &'static str, dir: &str, list: &str) -> Self {
        let frequencies: Vec<u64> = std::fs::read_to_string(format!("{dir}/{list}"))
            .unwrap_or_default()
            .split_whitespace()
            .filter_map(|f| f.parse().ok())
            .collect();
        Self {
            name,
            path: format!("{dir}/{}", if dir == CPU_POLICY { "scaling_min_freq" } else { "min_freq" }),
            low: frequencies.iter().copied().min().unwrap_or(0),
            high: frequencies.iter().copied().max().unwrap_or(0),
            raised: false,
            broken: frequencies.is_empty(),
        }
    }

    fn set(&mut self, raised: bool) {
        if self.broken || self.raised == raised {
            return;
        }
        self.raised = raised;
        let hz = if raised { self.high } else { self.low };
        if let Err(e) = std::fs::write(&self.path, hz.to_string()) {
            eprintln!("omarchy-pocket-host: {} floor {}: {e}; leaving the governor alone", self.name, self.path);
            self.broken = true;
        }
    }
}

pub struct Floors {
    floors: Vec<Floor>,
    last: Instant,
}

impl Floors {
    pub fn new() -> Self {
        Self {
            floors: vec![
                Floor::new("GPU", GPU_DEVFREQ, "available_frequencies"),
                Floor::new("CPU", CPU_POLICY, "scaling_available_frequencies"),
            ],
            last: Instant::now() - IDLE,
        }
    }

    /// Once per tick: whether input arrived or a frame is presented this tick.
    pub fn tick(&mut self, active: bool) {
        if active {
            self.last = Instant::now();
            for f in &mut self.floors {
                f.set(true);
            }
        } else if self.last.elapsed() > IDLE {
            for f in &mut self.floors {
                f.set(false);
            }
        }
    }
}

impl Drop for Floors {
    fn drop(&mut self) {
        for f in &mut self.floors {
            f.set(false);
        }
    }
}

/// Second handles on the input devices, polled for readiness and drained.
pub struct InputProbe {
    files: Vec<File>,
    scratch: Vec<u8>,
}

impl InputProbe {
    pub fn open(paths: &[impl AsRef<Path>]) -> Self {
        use std::os::unix::fs::OpenOptionsExt;
        let files = paths
            .iter()
            .filter_map(|p| std::fs::OpenOptions::new().read(true).custom_flags(libc::O_NONBLOCK | libc::O_CLOEXEC).open(p).ok())
            .collect();
        Self { files, scratch: vec![0; 4096] }
    }

    /// Whether any device has events waiting; what waits is read and dropped
    /// (each open handle has a queue of its own).
    pub fn poll(&mut self) -> bool {
        if self.files.is_empty() {
            return false;
        }
        let mut fds: Vec<libc::pollfd> = self.files.iter().map(|f| libc::pollfd { fd: f.as_raw_fd(), events: libc::POLLIN, revents: 0 }).collect();
        let ready = unsafe { libc::poll(fds.as_mut_ptr(), fds.len() as libc::nfds_t, 0) };
        if ready <= 0 {
            return false;
        }
        let mut active = false;
        for (i, fd) in fds.iter().enumerate() {
            if fd.revents & libc::POLLIN == 0 {
                continue;
            }
            active = true;
            while matches!(self.files[i].read(&mut self.scratch), Ok(n) if n > 0) {}
        }
        active
    }
}
