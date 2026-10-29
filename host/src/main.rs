//! The Anbernic RG DS Plus program: one package on both 1024x768 DSI panels,
//! rendered by the Mali-G52 (GBM/EGL/GLES on KMS, gpu.rs: DSI-1 is the primary
//! surface on top, DSI-2 the auxiliary surface below), the gamepad and buttons
//! as buttons and the Goodix panel as touch on the lower surface (evdev).
//! Omarchy Pocket's shell runs on it.
//!
//! `--shot DIR --script "…"` runs the package on any system without the panels
//! and inputs, for layout work: scripted buttons and taps, the CPU raster
//! renderer and two in-memory panels written to DIR/<tick>-top.xrgb and
//! DIR/<tick>-bottom.xrgb at each `shot` event (shot.rs). The device itself
//! never renders on the CPU.
use pocket_drivers::{Clock, InputClasses};
use pocket_linux_hooks::{FileSource, MonotonicClock};
use pocket_package::source::LoadedPackage;
use pocket_runtime::{timing::TickSchedule, Profile, Runtime, RuntimeConfig};
use std::{
    error::Error,
    io,
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
};

mod bridge;
mod children;
#[cfg(target_os = "linux")]
mod gpu;
mod guest;
mod net;
mod shot;

#[allow(dead_code)] // The export defines every fact; the program reads some.
mod profile {
    include!(concat!(env!("OUT_DIR"), "/pocket_profile.rs"));
}

/// The gamepad (`ANBERNIC-rk3568-keys`), measured on the device and matching
/// the stock firmware's SDL mapping: A confirms (CIRCLE, the framework's focus
/// press), B goes back. The D-pad is a hat; the sticks are not mapped yet.
#[cfg(target_os = "linux")]
const GAMEPAD: &[(u16, u32)] = {
    use pocket_spec::btn;
    &[
        (304, btn::CIRCLE),   // A
        (305, btn::CROSS),    // B
        // the stock SDL entry for ANBERNIC-keys: x:b3, y:b2
        (307, btn::TRIANGLE), // X
        (306, btn::SQUARE),   // Y
        (308, btn::LTRIGGER), // L1
        (309, btn::RTRIGGER), // R1
        (314, btn::ZL),       // L2
        (315, btn::ZR),       // R2
        (310, btn::SELECT),   // Select (SDL's guide)
        (311, btn::START),    // Start
    ]
};
const PACKAGE_LIMIT: usize = 64 * 1024 * 1024;
const DEFAULT_PACKAGE: &str = "/usr/share/pocketjs/omarchy-pocket.pocket";
/// Input classes the evdev drivers deliver here: buttons and touch.
const INPUT_CLASSES: InputClasses =
    InputClasses::from_bits(InputClasses::BUTTONS.bits() | InputClasses::CONTACT.bits());

static STOP: AtomicBool = AtomicBool::new(false);
extern "C" fn stop(_: libc::c_int) {
    STOP.store(true, Ordering::Relaxed);
}
fn error(value: impl std::fmt::Debug) -> io::Error {
    io::Error::other(format!("{value:?}"))
}

struct Options {
    package: Option<PathBuf>,
    card: PathBuf,
    top: String,
    bottom: String,
    inputs: Vec<PathBuf>,
    touch_on_top: bool,
    bridge: Option<PathBuf>,
    shot: Option<PathBuf>,
    script: Option<String>,
    check: bool,
}

fn options() -> Result<Option<Options>, Box<dyn Error>> {
    let mut output = Options {
        package: None,
        card: "/dev/dri/card0".into(),
        top: "DSI-1".into(),
        bottom: "DSI-2".into(),
        inputs: Vec::new(),
        touch_on_top: false,
        bridge: None,
        shot: None,
        script: None,
        check: false,
    };
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--help" => {
                println!("omarchy-pocket-host [--package app.pocket] [--card /dev/dri/card0] [--top DSI-1] [--bottom DSI-2]\n                  [--input /dev/input/eventN]... [--touch-on-top] [--bridge PATH] [--check]\n                  [--shot DIR --script \"30:DOWN 45:tap@256,190 90:shot\"]\nProfile {} is compiled in. Default package: {DEFAULT_PACKAGE}. Default bridge: $XDG_RUNTIME_DIR/omarchy-pocket/bridge.sock, omarchy-pocketd's socket. Touch lands on the lower panel unless --touch-on-top. The program exits on SIGINT, SIGTERM, or after the script's last event.", profile::ID);
                return Ok(None);
            }
            "--check" => output.check = true,
            "--touch-on-top" => output.touch_on_top = true,
            "--package" | "--card" | "--top" | "--bottom" | "--input" | "--bridge" | "--shot" | "--script" => {
                let value = args.next().ok_or_else(|| error("missing option value"))?;
                match arg.as_str() {
                    "--package" => output.package = Some(value.into()),
                    "--card" => output.card = value.into(),
                    "--top" => output.top = value,
                    "--bottom" => output.bottom = value,
                    "--input" => output.inputs.push(value.into()),
                    "--bridge" => output.bridge = Some(value.into()),
                    "--shot" => output.shot = Some(value.into()),
                    _ => output.script = Some(value),
                }
            }
            _ => return Err(error(format!("unknown option {arg}")).into()),
        }
    }
    Ok(Some(output))
}

/// Demand presentation. The GBM displays report no buffer identity, so the
/// presenter cannot know their pixels are retained and redraws both panels
/// on every present. A tick whose draw lists equal the last presented ones
/// skips rendering and the page flip; the panels keep showing that frame. A
/// tick that changed one panel's list swaps and flips that panel alone.
#[derive(Default)]
struct Presented {
    primary: Vec<u32>,
    auxiliary: Vec<u32>,
    ticks: u32,
}

impl Presented {
    /// Draws both lists and reports whether either differs from the last
    /// presented frame, remembering the new ones.
    fn changed(&mut self, runtime: &Runtime) -> Result<(bool, bool), Box<dyn Error>> {
        let ops = runtime.op_context();
        let mut state = ops.core_mut().map_err(error)?;
        let primary = &state.ui.draw().words;
        let top = *primary != self.primary;
        if top {
            self.primary.clone_from(primary);
        }
        let mut bottom = false;
        if let Some(auxiliary) = state.ui.draw_auxiliary() {
            if auxiliary.words != self.auxiliary {
                self.auxiliary.clone_from(&auxiliary.words);
                bottom = true;
            }
        }
        Ok((top, bottom))
    }

    /// Whether `/tmp/pocket-shot` waits for a frame, checked twice a second.
    fn readback_due(&mut self) -> bool {
        self.ticks = self.ticks.wrapping_add(1);
        self.ticks % 30 == 0 && std::path::Path::new("/tmp/pocket-shot").exists()
    }
}

#[derive(Default)]
struct Timing {
    /// OMARCHY_POCKET_TIMING=frames (or frames=<ms>): also every tick over
    /// that long (20 ms), as it happens
    frames: Option<std::time::Duration>,
    ticks: u32,
    presents: u32,
    advance: std::time::Duration,
    draw: std::time::Duration,
    present: std::time::Duration,
}


impl Timing {
    fn record(&mut self, started: std::time::Instant, advanced: std::time::Instant, drawn: std::time::Instant, presented: bool) {
        self.ticks += 1;
        self.advance += advanced - started;
        self.draw += drawn - advanced;
        let present = if presented { drawn.elapsed() } else { std::time::Duration::ZERO };
        if presented {
            self.presents += 1;
            self.present += present;
        }
        if self.frames.is_some_and(|long| started.elapsed() > long) {
            let ms = |d: std::time::Duration| d.as_secs_f64() * 1000.0;
            eprintln!(
                "omarchy-pocket-host: long tick {:.1} ms: guest+core {:.1}, draw+compare {:.1}, present {:.1}",
                ms(started.elapsed()), ms(advanced - started), ms(drawn - advanced), ms(present)
            );
        }
        if self.ticks == 300 {
            let per = |d: std::time::Duration, n: u32| d.as_micros() as f64 / n.max(1) as f64;
            eprintln!(
                "omarchy-pocket-host: {} ticks: guest+core {:.0} us, draw+compare {:.0} us; {} presents {:.0} us",
                self.ticks, per(self.advance, self.ticks), per(self.draw, self.ticks), self.presents, per(self.present, self.presents)
            );
            *self = Timing { frames: self.frames, ..Timing::default() };
        }
    }
}

/// omarchy-pocketd runs in the same user's systemd manager and listens in its
/// runtime directory.
fn default_bridge() -> PathBuf {
    let runtime = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| format!("/run/user/{}", unsafe { libc::getuid() }).into());
    runtime.join("omarchy-pocket").join("bridge.sock")
}

/// Reject display and input facts these drivers cannot honor: two fixed
/// panels, buttons and touch.
fn supported(profile: Profile) -> Result<Profile, Box<dyn Error>> {
    if profile.dynamic_viewport.is_some()
        || profile.auxiliary.is_none()
        || !INPUT_CLASSES.contains(profile.required_inputs)
    {
        return Err(error("profile promises facts this program cannot honor").into());
    }
    Ok(profile)
}

fn run(options: Options) -> Result<(), Box<dyn Error>> {
    let profile = supported(profile::profile().ok_or_else(|| error("missing exported profile"))?)?;
    let shell = options
        .package
        .clone()
        .unwrap_or_else(|| DEFAULT_PACKAGE.into());
    if options.check {
        let mut source = FileSource::open(&shell)?;
        LoadedPackage::load(
            &mut source,
            profile::ID,
            profile::HOST_ABI,
            &profile::PROFILE_HASH,
            PACKAGE_LIMIT,
        )
        .map_err(error)?;
        println!("package admitted: {} ({})", shell.display(), profile.id);
        return Ok(());
    }
    unsafe {
        libc::signal(libc::SIGINT, stop as *const () as libc::sighandler_t);
        libc::signal(libc::SIGTERM, stop as *const () as libc::sighandler_t);
    }
    run_package(&options, &profile, &shell)
}

/// Runs the shell until the program stops. The pocket apps it opens run in
/// its windows (children.rs), never in its place.
fn run_package(options: &Options, profile: &Profile, path: &PathBuf) -> Result<(), Box<dyn Error>> {
    let profile = profile.clone();
    let top = profile.viewport;
    let bottom = profile.auxiliary.unwrap();
    let source = FileSource::open(path)?;
    if pocket_drivers::PackageSource::length(&source).map_err(error)? > PACKAGE_LIMIT {
        return Err(error("package exceeds 64 MiB").into());
    }
    let pixels = top[0] as usize * top[1] as usize + bottom[0] as usize * bottom[1] as usize;
    let mut runtime = Runtime::new(RuntimeConfig {
        profile_hash: profile::PROFILE_HASH,
        host_abi: profile::HOST_ABI,
        heap_limit: 48 * 1024 * 1024,
        frame_buffer_budget: pixels * 8,
        profile: profile.clone(),
    })
    .map_err(error)?;
    #[cfg(target_os = "linux")]
    let mut compositor: Option<gpu::Compositor> = None;
    let mut shot = match options.shot.clone() {
        Some(directory) => {
            let renderer = runtime
                .add_renderer(pocket_raster::RasterRenderer::new(profile.density).map_err(error)?)
                .map_err(error)?;
            Some(shot::attach(
                &mut runtime,
                renderer,
                [top, bottom],
                profile.auxiliary_logical[0],
                directory,
                options.script.as_deref().unwrap_or(""),
            )?)
        }
        None => {
            #[cfg(target_os = "linux")]
            {
                compositor = Some(attach_devices(&mut runtime, &profile, options)?);
            }
            #[cfg(not(target_os = "linux"))]
            attach_devices(&mut runtime, &profile, options)?;
            None
        }
    };
    runtime
        .set_package_source(Box::new(source))
        .map_err(error)?;
    let repaint: guest::Repaint = Default::default();
    // a --shot run has no daemon to talk to
    let bridge = options.shot.is_none().then(|| options.bridge.clone().unwrap_or_else(default_bridge));
    let bridge = std::rc::Rc::new(std::cell::RefCell::new(bridge::Bridge::new(bridge)));
    let net = net::Hub::new(bridge.clone());
    let children = children::Children::new(net.clone());
    runtime
        .set_guest(Box::new(guest::BridgedGuest::new(bridge, repaint.clone(), children.clone(), net)))
        .map_err(error)?;
    runtime.boot().map_err(error)?;
    let mut clock = MonotonicClock::default();
    let mut schedule = TickSchedule::new(profile.tick_hz, clock.now(), 1).map_err(error)?;
    let mut presented = Presented::default();
    #[cfg(target_os = "linux")]
    let mut gpu_floor = (shot.is_none()).then(gpu::GpuFloor::new);
    // OMARCHY_POCKET_TIMING=1: mean costs of each tick's phases every 5 s;
    // =frames[=<ms>]: and each tick over 20 ms (or <ms>)
    let mut timing = std::env::var("OMARCHY_POCKET_TIMING").ok().map(|v| {
        let frames = v.strip_prefix("frames").map(|ms| std::time::Duration::from_millis(ms.trim_start_matches('=').parse().unwrap_or(20)));
        Timing { frames, ..Timing::default() }
    });
    while !STOP.load(Ordering::Relaxed) {
        schedule.wait_next(&mut clock).map_err(error)?;
        if let Some(shot) = shot.as_mut() {
            if !shot.before_tick() {
                break;
            }
        }
        let started = timing.as_ref().map(|_| std::time::Instant::now());
        runtime.advance().map_err(error)?;
        // the apps in the shell's windows: opened, closed and advanced after the shell's turn
        #[cfg(target_os = "linux")]
        let app_frames = compositor.as_ref().is_some_and(|c| children.borrow_mut().tick(&mut runtime, &profile, c));
        #[cfg(not(target_os = "linux"))]
        let app_frames = false;
        let advanced = timing.as_ref().map(|_| std::time::Instant::now());
        // --shot frames, GPU readbacks, a new glyph atlas and an app's new
        // frame need every panel presented
        let forced = shot.is_some() || presented.readback_due() || repaint.replace(false) || app_frames;
        let (top, bottom) = presented.changed(&runtime)?;
        let changed = top || bottom;
        let drawn = timing.as_ref().map(|_| std::time::Instant::now());
        #[cfg(target_os = "linux")]
        if let Some(floor) = gpu_floor.as_mut() {
            floor.tick(changed || forced);
        }
        if changed || forced {
            // a panel whose list is the one it shows keeps its frame (no swap, no flip)
            #[cfg(target_os = "linux")]
            gpu::hold(!top && !forced, !bottom && !forced);
            runtime.present().map_err(error)?;
        } else {
            runtime.skip_presentation().map_err(error)?;
        }
        if let (Some(t), Some(started), Some(advanced), Some(drawn)) = (timing.as_mut(), started, advanced, drawn) {
            t.record(started, advanced, drawn, changed || forced);
        }
        if let Some(shot) = shot.as_mut() {
            shot.after_tick()?;
        }
    }
    runtime.shutdown().map_err(error)?;
    Ok(())
}

/// Both panels on the GPU and every evdev device. Linux only: on another
/// system the program builds for --shot and its unit tests.
#[cfg(target_os = "linux")]
fn attach_devices(
    runtime: &mut Runtime,
    profile: &Profile,
    options: &Options,
) -> Result<gpu::Compositor, Box<dyn Error>> {
    use gpu::PanelSpec;
    use pocket_drivers::{DisplayRole, InputSource};
    let (renderer, displays, compositor) = gpu::open(
        &options.card,
        &[
            PanelSpec {
                connector: &options.top,
                size: profile.viewport,
                role: DisplayRole::Primary,
            },
            PanelSpec {
                connector: &options.bottom,
                size: profile.auxiliary.unwrap(),
                role: DisplayRole::Auxiliary,
            },
        ],
    )?;
    let renderer = runtime.add_renderer(renderer).map_err(error)?;
    for display in displays {
        runtime.add_display(display, renderer).map_err(error)?;
    }
    let mut inputs = options.inputs.clone();
    if inputs.is_empty() {
        if let Ok(entries) = std::fs::read_dir("/dev/input") {
            inputs = entries
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|path| {
                    path.file_name()
                        .is_some_and(|name| name.to_string_lossy().starts_with("event"))
                })
                .collect();
            inputs.sort();
        }
    }
    let (touch_surface, touch_extent) = if options.touch_on_top {
        (0, profile.logical_viewports[0])
    } else {
        (1, profile.auxiliary_logical[0])
    };
    for (index, path) in inputs.iter().take(16).enumerate() {
        let mut device = pocket_linux_evdev::Evdev::open(
            path,
            profile.logical_viewports[0],
            index as u32 * 16,
            16,
        )?;
        if device.classes().contains(InputClasses::CONTACT) {
            device.set_surface(touch_surface, touch_extent)?;
        }
        let name = path.file_name().and_then(|event| {
            std::fs::read_to_string(format!(
                "/sys/class/input/{}/device/name",
                event.to_string_lossy()
            ))
            .ok()
        });
        if name.as_deref().map(str::trim) == Some("ANBERNIC-rk3568-keys") {
            device.set_keymap(GAMEPAD);
        }
        runtime.add_input_source(Box::new(device)).map_err(error)?;
    }
    Ok(compositor)
}

#[cfg(not(target_os = "linux"))]
fn attach_devices(_: &mut Runtime, _: &Profile, _: &Options) -> Result<(), Box<dyn Error>> {
    Err(error("the panel and input drivers require Linux; use --shot").into())
}

fn main() {
    match options().and_then(|options| match options {
        Some(options) => run(options),
        None => Ok(()),
    }) {
        Ok(()) => {}
        Err(error) => {
            eprintln!("omarchy-pocket-host: {error}");
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn drivers_reject_facts_they_cannot_honor() {
        let exported = profile::profile().unwrap();
        assert!(supported(exported.clone()).is_ok());
        let mut single = exported.clone();
        single.auxiliary = None;
        let mut text = exported;
        text.required_inputs |= InputClasses::TEXT;
        for profile in [single, text] {
            assert!(supported(profile).is_err());
        }
    }
}
