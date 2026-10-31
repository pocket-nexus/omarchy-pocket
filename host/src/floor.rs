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
//! Input is seen before the runtime samples it: the probe polls the
//! runtime's own evdev descriptors for readiness (found through
//! /proc/self/fd, never read, never a second client of the device) at the
//! top of each tick, so the clocks are up before the guest work the input
//! causes.
use std::{
    os::fd::RawFd,
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

/// The runtime's input descriptors, polled for readiness.
pub struct InputProbe {
    fds: Vec<libc::pollfd>,
}

impl InputProbe {
    /// Every descriptor this process holds on /dev/input/event*, as the
    /// runtime opened them.
    pub fn open() -> Self {
        let mut fds = Vec::new();
        if let Ok(entries) = std::fs::read_dir("/proc/self/fd") {
            for entry in entries.flatten() {
                let Ok(target) = std::fs::read_link(entry.path()) else { continue };
                if !target.to_string_lossy().starts_with("/dev/input/event") {
                    continue;
                }
                if let Some(fd) = entry.file_name().to_str().and_then(|n| n.parse::<RawFd>().ok()) {
                    fds.push(libc::pollfd { fd, events: libc::POLLIN, revents: 0 });
                }
            }
        }
        Self { fds }
    }

    /// Whether any device has events waiting for the runtime to read.
    pub fn poll(&mut self) -> bool {
        if self.fds.is_empty() {
            return false;
        }
        for fd in &mut self.fds {
            fd.revents = 0;
        }
        let ready = unsafe { libc::poll(self.fds.as_mut_ptr(), self.fds.len() as libc::nfds_t, 0) };
        ready > 0 && self.fds.iter().any(|fd| fd.revents & libc::POLLIN != 0)
    }
}
