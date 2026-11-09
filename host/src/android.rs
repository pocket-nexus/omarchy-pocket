//! The AYN Thor program: the same host as the RG DS Plus, built as
//! libomarchy_pocket.so and loaded by the Android app in android/app. The
//! shell package runs on one thread of its own (`start`), on both displays
//! (gpu_android.rs: the upper display is the primary surface in the
//! activity's SurfaceView, the lower one the auxiliary surface in a
//! Presentation's), with the Odin controller as buttons and sticks and the
//! lower display's touch as contacts on the auxiliary surface. The Java side
//! (android/app's Gamepad.java) maps Android's key codes and axes to
//! PocketJS buttons; the upper display's touch is not used.
//!
//! The bridge to omarchy-pocketd (bridge.rs, guest.rs), the apps in the
//! shell's windows (children.rs, compositor.rs), their network (net.rs)
//! and media plane (media.rs) are the RG DS Plus's own. omarchy-pocketd runs
//! in the app's Linux root under proot (android/app's Linux.java) and
//! listens on the bridge path the app passes in; the daemon's absolute paths
//! lie under that root (guest.rs `host_path`). The root itself arrives as a
//! .tar.zst the app unpacks with `installRoot` (android_root.rs).
//!
//! The threads: Android calls in on its UI thread. Buttons, axes and
//! contacts go into `Shared::input`, which the runtime's input source reads
//! at the top of each tick. A SurfaceView's surface changes go into
//! `Shared::windows`; the shell's thread attaches or detaches the EGL surface
//! at its next tick and acknowledges, and `setSurface` waits for that, so a
//! surface Android destroys is never drawn to afterwards.
#![cfg(target_os = "android")]

use jni::{
    objects::{JClass, JObject, JString},
    sys::{jboolean, jfloat, jint, JNI_TRUE},
    JNIEnv,
};
use pocket_drivers::{AxisSample, CancelledContact, Clock, Contact, DisplayRole, InputClasses, InputFrameBuilder, InputSource};
use pocket_linux_hooks::{FileSource, MonotonicClock};
use pocket_runtime::{timing::TickSchedule, Runtime, RuntimeConfig};
use std::{
    collections::HashMap,
    error::Error,
    io,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Condvar, Mutex, OnceLock,
    },
    time::Duration,
};

#[path = "android_root.rs"]
mod root;
mod bridge;
mod children;
mod compositor;
mod egl;
#[path = "gpu_android.rs"]
mod gpu;
mod guest;
mod media;
mod net;

#[allow(dead_code)] // The export defines every fact; the program reads some.
mod profile {
    include!(concat!(env!("OUT_DIR"), "/pocket_profile.rs"));
}

const PACKAGE_LIMIT: usize = 64 * 1024 * 1024;
const INPUT_CLASSES: InputClasses = InputClasses::from_bits(
    InputClasses::BUTTONS.bits() | InputClasses::CONTACT.bits() | InputClasses::AXIS_ABSOLUTE.bits(),
);

fn error(value: impl std::fmt::Debug) -> io::Error {
    io::Error::other(format!("{value:?}"))
}

// ---- logcat ------------------------------------------------------------------

#[link(name = "log")]
unsafe extern "C" {
    fn __android_log_write(priority: i32, tag: *const std::ffi::c_char, text: *const std::ffi::c_char) -> i32;
}

/// Every module reports with eprintln!, as on the RG DS Plus; an app's
/// stderr goes nowhere, so a thread copies it to logcat line by line.
fn stderr_to_logcat() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| unsafe {
        let mut fds = [0; 2];
        if libc::pipe(fds.as_mut_ptr()) != 0 {
            return;
        }
        libc::dup2(fds[1], 1);
        libc::dup2(fds[1], 2);
        let read = fds[0];
        std::thread::Builder::new()
            .name("logcat".into())
            .spawn(move || {
                use std::io::BufRead;
                let file = <std::fs::File as std::os::fd::FromRawFd>::from_raw_fd(read);
                for line in std::io::BufReader::new(file).lines() {
                    let Ok(line) = line else { break };
                    if let Ok(text) = std::ffi::CString::new(line) {
                        __android_log_write(4, c"omarchy-pocket".as_ptr(), text.as_ptr());
                    }
                }
            })
            .ok();
    });
}

// ---- state shared with Android's threads ---------------------------------------

struct WindowPtr(*mut gpu::ANativeWindow);
// An ANativeWindow is reference counted and may be used from any thread.
unsafe impl Send for WindowPtr {}

#[derive(Default)]
struct WindowSlots {
    /// a window (or None: the surface went away) for each display, not yet
    /// taken by the shell's thread
    pending: [Option<Option<WindowPtr>>; 2],
    generation: u64,
    acknowledged: u64,
    running: bool,
}

#[derive(Default)]
struct Input {
    held: u32,
    /// pressed since the last tick: a press and release inside one tick still counts
    latched: u32,
    /// sticks on the runtime's 0..=255 scale, 128 at rest
    sticks: [f32; 4],
    /// contacts on the lower display, by Android pointer id: (id, x, y) in logical points
    contacts: HashMap<i32, (u32, f32, f32)>,
    /// lifted before a tick reported them: shown for one tick
    lifted: Vec<(u32, f32, f32)>,
    cancelled: Vec<u32>,
    next_id: u32,
}

struct Shared {
    windows: Mutex<WindowSlots>,
    changed: Condvar,
    input: Mutex<Input>,
    /// lines for the shell from the Android side (`Native.shellEvent`),
    /// delivered with the daemon's
    events: Mutex<Vec<String>>,
    stop: AtomicBool,
}

fn shared() -> &'static Shared {
    static SHARED: OnceLock<Shared> = OnceLock::new();
    SHARED.get_or_init(|| Shared {
        windows: Mutex::new(WindowSlots::default()),
        changed: Condvar::new(),
        input: Mutex::new(Input { sticks: [128.0; 4], ..Input::default() }),
        events: Mutex::new(Vec::new()),
        stop: AtomicBool::new(false),
    })
}

/// The runtime's input source: what Android delivered since the last tick.
struct AndroidInput {
    extent: [f32; 2],
}

impl InputSource for AndroidInput {
    fn classes(&self) -> InputClasses {
        INPUT_CLASSES
    }
    fn poll(&mut self, frame: &mut InputFrameBuilder) {
        let mut input = shared().input.lock().unwrap();
        frame.buttons |= input.held | input.latched;
        input.latched = 0;
        for (id, value) in input.sticks.iter().enumerate() {
            frame.axes.push(AxisSample { id: id as u32, value: *value });
        }
        for &(id, x, y) in input.contacts.values().chain(input.lifted.iter()) {
            frame.contacts.push(Contact { surface: 1, id, x: x * self.extent[0], y: y * self.extent[1], cancelled: false });
        }
        input.lifted.clear();
        for id in input.cancelled.drain(..) {
            frame.cancelled.push(CancelledContact { surface: 1, id });
        }
    }
}

// ---- the shell's thread ----------------------------------------------------------

struct Options {
    package: PathBuf,
    bridge: PathBuf,
}

/// Draws both lists and reports whether either differs from the last presented frame.
#[derive(Default)]
struct Presented {
    primary: Vec<u32>,
    auxiliary: Vec<u32>,
}

impl Presented {
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
}

/// Takes the windows Android lent or took back since the last tick.
/// Returns whether any changed.
fn take_windows(windows: &gpu::Windows) -> bool {
    let shared = shared();
    let mut slots = shared.windows.lock().unwrap();
    let mut changed = false;
    for index in 0..2 {
        if let Some(window) = slots.pending[index].take() {
            changed = true;
            match window {
                Some(WindowPtr(window)) => match windows.attach(index, window) {
                    Ok(()) => eprintln!("omarchy-pocket: display {index} on a window"),
                    Err(e) => eprintln!("omarchy-pocket: display {index}: {e}"),
                },
                None => {
                    windows.detach(index);
                    eprintln!("omarchy-pocket: display {index} off its window");
                }
            }
        }
    }
    slots.acknowledged = slots.generation;
    shared.changed.notify_all();
    changed
}

fn run(options: Options) -> Result<(), Box<dyn Error>> {
    let profile = profile::profile().ok_or_else(|| error("missing exported profile"))?;
    let top = profile.viewport;
    let bottom = profile.auxiliary.ok_or_else(|| error("the profile has no auxiliary display"))?;
    let source = FileSource::open(&options.package)?;
    if pocket_drivers::PackageSource::length(&source).map_err(error)? > PACKAGE_LIMIT {
        return Err(error("package exceeds 64 MiB").into());
    }
    let pixels = top[0] as usize * top[1] as usize + bottom[0] as usize * bottom[1] as usize;
    let mut runtime = Runtime::new(RuntimeConfig {
        profile_hash: profile::PROFILE_HASH,
        host_abi: profile::HOST_ABI,
        heap_limit: 64 * 1024 * 1024,
        frame_buffer_budget: pixels * 8,
        profile: profile.clone(),
    })
    .map_err(error)?;
    let (renderer, displays, compositor, windows) = gpu::open(&[(DisplayRole::Primary, top), (DisplayRole::Auxiliary, bottom)])?;
    let renderer = runtime.add_renderer(renderer).map_err(error)?;
    for display in displays {
        runtime.add_display(display, renderer).map_err(error)?;
    }
    let extent = profile.auxiliary_logical[0];
    runtime.add_input_source(Box::new(AndroidInput { extent: [extent[0] as f32, extent[1] as f32] })).map_err(error)?;
    runtime.set_package_source(Box::new(source)).map_err(error)?;
    let repaint: guest::Repaint = Default::default();
    let traffic: guest::Traffic = Default::default();
    let profile_request: guest::ProfileRequest = Default::default();
    let bridge = std::rc::Rc::new(std::cell::RefCell::new(bridge::Bridge::new(Some(options.bridge.clone()))));
    let net = net::Hub::new(bridge.clone());
    let children = children::Children::new(net.clone());
    let mut guest = guest::BridgedGuest::new(bridge, repaint.clone(), traffic.clone(), profile_request.clone(), children.clone(), net);
    guest.set_injected(Box::new(|| std::mem::take(&mut *shared().events.lock().unwrap())));
    runtime.set_guest(Box::new(guest)).map_err(error)?;
    // the boot presents a first frame: it waits for the upper display's
    // window (the lower one may be switched off) and briefly for the lower's
    let shared = shared();
    let started = std::time::Instant::now();
    while !windows.shown(0) || !windows.shown(1) && started.elapsed() < Duration::from_secs(2) {
        if shared.stop.load(Ordering::Relaxed) {
            return Ok(());
        }
        take_windows(&windows);
        let slots = shared.windows.lock().unwrap();
        if slots.pending.iter().all(Option::is_none) {
            let _ = shared.changed.wait_timeout(slots, Duration::from_millis(250)).unwrap();
        }
    }
    runtime.boot().map_err(error)?;
    eprintln!("omarchy-pocket: shell booted from {} ({} {}x{} + {}x{})", options.package.display(), profile::ID, top[0], top[1], bottom[0], bottom[1]);
    let mut clock = MonotonicClock::default();
    let cadence_hz = runtime.timing().ok_or_else(|| error("the shell did not boot"))?.cadence_hz;
    let mut schedule = TickSchedule::new(cadence_hz, clock.now(), 1).map_err(error)?;
    let mut presented = Presented::default();
    while !shared.stop.load(Ordering::Relaxed) {
        let new_windows = take_windows(&windows);
        let visible = windows.any();
        if visible {
            schedule.wait_next(&mut clock).map_err(error)?;
        } else {
            // in the background: the shell keeps its timers and the bridge at 10 Hz
            let slots = shared.windows.lock().unwrap();
            let _ = shared.changed.wait_timeout(slots, Duration::from_millis(100)).unwrap();
            schedule = TickSchedule::new(cadence_hz, clock.now(), 1).map_err(error)?;
        }
        runtime.advance().map_err(error)?;
        let app_frames = children.borrow_mut().tick(&mut runtime, &profile, &compositor);
        let forced = new_windows || repaint.replace(false) || app_frames;
        let (top, bottom) = presented.changed(&runtime)?;
        traffic.set(false);
        profile_request.set(None);
        if visible && (top || bottom || forced) {
            gpu::hold(!top && !forced, !bottom && !forced);
            // The presenter is pipelined: a present completes the previous
            // frame (the renderer's wait, then the displays' swaps) before it
            // renders this one. Presenting on demand, the frame would wait
            // for the next change (and a window just lent would show the
            // frame before it, nothing); completing it at once puts it on the
            // displays this tick. The Adreno's wait is a millisecond or two.
            // A window Android takes away between the check and the swap
            // fails one present.
            if let Err(e) = runtime.present().and_then(|()| runtime.complete_presentation()) {
                eprintln!("omarchy-pocket: present: {e:?}");
                presented = Presented::default();
            }
        } else {
            runtime.skip_presentation().map_err(error)?;
        }
    }
    runtime.shutdown().map_err(error)?;
    Ok(())
}

// ---- JNI: dev.pocketnexus.omarchy.Native -------------------------------------------

#[link(name = "android")]
unsafe extern "C" {
    fn ANativeWindow_fromSurface(env: *mut jni::sys::JNIEnv, surface: jni::sys::jobject) -> *mut gpu::ANativeWindow;
}

fn string(env: &mut JNIEnv, value: &JString) -> String {
    env.get_string(value).map(Into::into).unwrap_or_default()
}

/// Starts the shell's thread once per process: the shell outlives the
/// activity, which only lends it windows.
#[no_mangle]
pub extern "system" fn Java_dev_pocketnexus_omarchy_Native_start(mut env: JNIEnv, _: JClass, package: JString, bridge: JString, root: JString) {
    stderr_to_logcat();
    // the daemon's paths (wallpaper tiles, glyph atlases, applets) lie under the Linux root
    guest::set_guest_root(string(&mut env, &root).into());
    let options = Options { package: string(&mut env, &package).into(), bridge: string(&mut env, &bridge).into() };
    let shared = shared();
    {
        let mut slots = shared.windows.lock().unwrap();
        if slots.running {
            return;
        }
        slots.running = true;
        shared.stop.store(false, Ordering::Relaxed);
    }
    std::thread::Builder::new()
        .name("pocket-shell".into())
        .spawn(move || {
            if let Err(e) = run(options) {
                eprintln!("omarchy-pocket: the shell stopped: {e}");
            }
            let shared = self::shared();
            let mut slots = shared.windows.lock().unwrap();
            slots.running = false;
            // windows lent to a thread that ended go back
            for slot in slots.pending.iter_mut() {
                if let Some(Some(WindowPtr(window))) = slot.take() {
                    unsafe { gpu::ANativeWindow_release(window) };
                }
            }
            slots.acknowledged = slots.generation;
            shared.changed.notify_all();
        })
        .expect("spawn the shell's thread");
}

/// A display's surface (0 upper, 1 lower) arrived, changed or went away
/// (null). Returns once the shell's thread has taken it.
#[no_mangle]
pub extern "system" fn Java_dev_pocketnexus_omarchy_Native_setSurface(env: JNIEnv, _: JClass, index: jint, surface: JObject) {
    let index = index.clamp(0, 1) as usize;
    let window = if surface.is_null() {
        None
    } else {
        let window = unsafe { ANativeWindow_fromSurface(env.get_raw(), surface.as_raw()) };
        (!window.is_null()).then_some(WindowPtr(window))
    };
    let shared = shared();
    let mut slots = shared.windows.lock().unwrap();
    if let Some(Some(WindowPtr(old))) = slots.pending[index].take() {
        unsafe { gpu::ANativeWindow_release(old) };
    }
    slots.pending[index] = Some(window);
    slots.generation += 1;
    let generation = slots.generation;
    shared.changed.notify_all();
    if !slots.running {
        return;
    }
    let (slots, timeout) = shared
        .changed
        .wait_timeout_while(slots, Duration::from_secs(3), |s| s.running && s.acknowledged < generation)
        .unwrap();
    if timeout.timed_out() {
        eprintln!("omarchy-pocket: display {index}: the shell's thread did not take the surface change");
    }
    drop(slots);
}

/// A PocketJS button (pocket_spec::btn bits) went down or up.
#[no_mangle]
pub extern "system" fn Java_dev_pocketnexus_omarchy_Native_button(_: JNIEnv, _: JClass, bits: jint, down: jboolean) {
    let mut input = shared().input.lock().unwrap();
    if down == JNI_TRUE {
        input.held |= bits as u32;
        input.latched |= bits as u32;
    } else {
        input.held &= !(bits as u32);
    }
}

/// The sticks, each axis -1..1 (left x, left y, right x, right y).
#[no_mangle]
pub extern "system" fn Java_dev_pocketnexus_omarchy_Native_sticks(_: JNIEnv, _: JClass, lx: jfloat, ly: jfloat, rx: jfloat, ry: jfloat) {
    let scale = |v: f32| (128.0 + v.clamp(-1.0, 1.0) * 127.0).round();
    shared().input.lock().unwrap().sticks = [scale(lx), scale(ly), scale(rx), scale(ry)];
}

/// A contact on the lower display at x, y (0..1 across the view): action 0
/// down or moved, 1 up, 2 cancelled.
#[no_mangle]
pub extern "system" fn Java_dev_pocketnexus_omarchy_Native_touch(_: JNIEnv, _: JClass, pointer: jint, action: jint, x: jfloat, y: jfloat) {
    let mut input = shared().input.lock().unwrap();
    let (x, y) = (x.clamp(0.0, 0.9999), y.clamp(0.0, 0.9999));
    match action {
        0 => {
            if let Some(contact) = input.contacts.get_mut(&pointer) {
                contact.1 = x;
                contact.2 = y;
            } else {
                // ids stay unique for a while so a new finger is never an old one
                input.next_id = (input.next_id + 1) % 1024;
                let id = 1 + input.next_id;
                input.contacts.insert(pointer, (id, x, y));
            }
        }
        1 => {
            if let Some(contact) = input.contacts.remove(&pointer) {
                input.lifted.push(contact);
            }
        }
        _ => {
            if let Some((id, ..)) = input.contacts.remove(&pointer) {
                input.cancelled.push(id);
            }
        }
    }
}

/// A line for the shell, as if omarchy-pocketd had sent it (JSON).
#[no_mangle]
pub extern "system" fn Java_dev_pocketnexus_omarchy_Native_shellEvent(mut env: JNIEnv, _: JClass, line: JString) {
    let line = string(&mut env, &line);
    shared().events.lock().unwrap().push(line);
}

/// Installs the Linux root from `archive` (a .tar.zst) into `root`, calling
/// `listener.progress(read, total)` (compressed bytes) on this thread.
/// Returns null, or what went wrong.
#[no_mangle]
pub extern "system" fn Java_dev_pocketnexus_omarchy_Native_installRoot<'a>(mut env: JNIEnv<'a>, _: JClass, archive: JString, root: JString, listener: JObject) -> JString<'a> {
    stderr_to_logcat();
    let archive = PathBuf::from(string(&mut env, &archive));
    let root = PathBuf::from(string(&mut env, &root));
    let started = std::time::Instant::now();
    let result = self::root::install(&archive, &root, |read, total| {
        let _ = env.call_method(&listener, "progress", "(JJ)V", &[(read as i64).into(), (total as i64).into()]);
        if env.exception_check().unwrap_or(false) {
            let _ = env.exception_clear();
        }
    });
    match result {
        Ok(entries) => {
            eprintln!("omarchy-pocket: installed {entries} entries from {} in {:.1} s", archive.display(), started.elapsed().as_secs_f64());
            JObject::null().into()
        }
        Err(e) => {
            eprintln!("omarchy-pocket: installing {}: {e}", archive.display());
            env.new_string(e.to_string()).unwrap_or_else(|_| JObject::null().into())
        }
    }
}

/// Stops the shell's thread (the app is finishing).
#[no_mangle]
pub extern "system" fn Java_dev_pocketnexus_omarchy_Native_stop(_: JNIEnv, _: JClass) {
    shared().stop.store(true, Ordering::Relaxed);
    shared().changed.notify_all();
}
