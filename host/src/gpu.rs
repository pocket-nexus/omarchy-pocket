//! GPU presentation on the RG DS Plus: Rockchip libmali's GBM and EGL on the
//! KMS card (Mali-G52, kbase driver; the kernel has no Panfrost), GLES 2
//! rendering through pocket-gles2, one GBM surface and EGL window surface per
//! panel, one EGL context for both. A flush swaps the panel's surface, adds
//! its front buffer to KMS once and page-flips it. The flip completes at the
//! panel's next acquire (taking the flip event for its CRTC and returning the
//! previous front buffer to GBM), not inside the present that queued it: a
//! present costs its rendering, and the flip lands while the next tick runs.
//! A panel whose draw list did not change (`hold`) is rendered but neither
//! swapped nor flipped, so it keeps showing its frame. A panel's next flip
//! is queued no sooner than 2 ms after its last one landed: the VOP2 drops
//! a config-done written in the lines after its frame start.
//!
//! EGL, GLES and GBM all come from libmali.so.1, which the program links
//! directly: libmali's libEGL/libGLESv2/libgbm are small wrappers that export
//! none of those symbols themselves.
use drm::{
    buffer::{Buffer, DrmFourcc, Handle as BufferHandle},
    control::{connector, crtc, framebuffer, Device as ControlDevice, Event, Mode, PageFlipFlags},
    Device,
};
use pocket_drivers::*;
use pocket_gles::{ContextAccess, TargetConfig, Viewport};
use std::{
    cell::{Cell, RefCell},
    ffi::{c_char, c_int, c_void},
    fs::{File, OpenOptions},
    io,
    os::fd::{AsFd, AsRawFd, BorrowedFd},
    path::Path,
    ptr,
    rc::Rc,
    time::{Duration, Instant},
};

#[allow(non_camel_case_types)]
mod ffi {
    use super::*;
    pub type EGLDisplay = *mut c_void;
    pub type EGLConfig = *mut c_void;
    pub type EGLContext = *mut c_void;
    pub type EGLSurface = *mut c_void;
    pub type EGLint = i32;
    pub type EGLBoolean = u32;
    pub enum gbm_device {}
    pub enum gbm_surface {}
    pub enum gbm_bo {}
    pub const EGL_NONE: EGLint = 0x3038;
    pub const EGL_SURFACE_TYPE: EGLint = 0x3033;
    pub const EGL_WINDOW_BIT: EGLint = 0x0004;
    pub const EGL_RENDERABLE_TYPE: EGLint = 0x3040;
    pub const EGL_OPENGL_ES2_BIT: EGLint = 0x0004;
    pub const EGL_RED_SIZE: EGLint = 0x3024;
    pub const EGL_GREEN_SIZE: EGLint = 0x3023;
    pub const EGL_BLUE_SIZE: EGLint = 0x3022;
    pub const EGL_ALPHA_SIZE: EGLint = 0x3021;
    pub const EGL_NATIVE_VISUAL_ID: EGLint = 0x302e;
    pub const EGL_CONTEXT_CLIENT_VERSION: EGLint = 0x3098;
    pub const EGL_OPENGL_ES_API: u32 = 0x30a0;
    pub const EGL_PLATFORM_GBM_KHR: u32 = 0x31d7;
    pub const GBM_FORMAT_XRGB8888: u32 = u32::from_le_bytes(*b"XR24");
    pub const GBM_BO_USE_SCANOUT: u32 = 1 << 0;
    pub const GBM_BO_USE_RENDERING: u32 = 1 << 2;
    pub type GetPlatformDisplay =
        unsafe extern "C" fn(u32, *mut c_void, *const isize) -> EGLDisplay;
    pub type CreatePlatformWindowSurface =
        unsafe extern "C" fn(EGLDisplay, EGLConfig, *mut c_void, *const isize) -> EGLSurface;
    #[link(name = "mali")]
    unsafe extern "C" {
        pub fn eglGetProcAddress(name: *const c_char) -> *mut c_void;
        pub fn eglInitialize(d: EGLDisplay, major: *mut EGLint, minor: *mut EGLint) -> EGLBoolean;
        pub fn eglBindAPI(api: u32) -> EGLBoolean;
        pub fn eglChooseConfig(
            d: EGLDisplay,
            attributes: *const EGLint,
            configs: *mut EGLConfig,
            size: EGLint,
            count: *mut EGLint,
        ) -> EGLBoolean;
        pub fn eglGetConfigAttrib(
            d: EGLDisplay,
            config: EGLConfig,
            attribute: EGLint,
            value: *mut EGLint,
        ) -> EGLBoolean;
        pub fn eglCreateContext(
            d: EGLDisplay,
            config: EGLConfig,
            share: EGLContext,
            attributes: *const EGLint,
        ) -> EGLContext;
        pub fn eglCreateWindowSurface(
            d: EGLDisplay,
            config: EGLConfig,
            window: *mut c_void,
            attributes: *const EGLint,
        ) -> EGLSurface;
        pub fn eglMakeCurrent(
            d: EGLDisplay,
            draw: EGLSurface,
            read: EGLSurface,
            context: EGLContext,
        ) -> EGLBoolean;
        pub fn eglGetCurrentContext() -> EGLContext;
        pub fn eglSwapBuffers(d: EGLDisplay, surface: EGLSurface) -> EGLBoolean;
        pub fn eglSwapInterval(d: EGLDisplay, interval: EGLint) -> EGLBoolean;
        pub fn eglDestroySurface(d: EGLDisplay, surface: EGLSurface) -> EGLBoolean;
        pub fn eglDestroyContext(d: EGLDisplay, context: EGLContext) -> EGLBoolean;
        pub fn eglTerminate(d: EGLDisplay) -> EGLBoolean;
        pub fn eglGetError() -> EGLint;
    }
    #[link(name = "mali")]
    unsafe extern "C" {
        pub fn gbm_create_device(fd: c_int) -> *mut gbm_device;
        pub fn gbm_device_destroy(device: *mut gbm_device);
        pub fn gbm_surface_create(
            device: *mut gbm_device,
            width: u32,
            height: u32,
            format: u32,
            flags: u32,
        ) -> *mut gbm_surface;
        pub fn gbm_surface_destroy(surface: *mut gbm_surface);
        pub fn gbm_surface_lock_front_buffer(surface: *mut gbm_surface) -> *mut gbm_bo;
        pub fn gbm_surface_release_buffer(surface: *mut gbm_surface, bo: *mut gbm_bo);
        /// `union gbm_bo_handle` is eight bytes, returned in a register.
        pub fn gbm_bo_get_handle(bo: *mut gbm_bo) -> u64;
        pub fn gbm_bo_get_stride(bo: *mut gbm_bo) -> u32;
        pub fn gbm_bo_map(
            bo: *mut gbm_bo,
            x: u32,
            y: u32,
            width: u32,
            height: u32,
            flags: u32,
            stride: *mut u32,
            map_data: *mut *mut c_void,
        ) -> *mut c_void;
        pub fn gbm_bo_unmap(bo: *mut gbm_bo, map_data: *mut c_void);
    }
    // pocket-gles declares the other gl* entry points without a library.
    #[link(name = "mali")]
    unsafe extern "C" {
        pub fn glReadPixels(
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            format: u32,
            kind: u32,
            pixels: *mut c_void,
        );
    }
    // offscreen targets for the apps in the shell's windows (Compositor)
    #[link(name = "mali")]
    unsafe extern "C" {
        pub fn glGenFramebuffers(n: i32, framebuffers: *mut u32);
        pub fn glDeleteFramebuffers(n: i32, framebuffers: *const u32);
        pub fn glBindFramebuffer(target: u32, framebuffer: u32);
        pub fn glFramebufferTexture2D(target: u32, attachment: u32, textarget: u32, texture: u32, level: i32);
        pub fn glCheckFramebufferStatus(target: u32) -> u32;
        pub fn glGenTextures(n: i32, textures: *mut u32);
        pub fn glDeleteTextures(n: i32, textures: *const u32);
        pub fn glBindTexture(target: u32, texture: u32);
        pub fn glTexImage2D(target: u32, level: i32, internal: i32, width: i32, height: i32, border: i32, format: u32, kind: u32, pixels: *const c_void);
        pub fn glTexParameteri(target: u32, name: u32, value: i32);
    }
    pub const GL_RGBA: u32 = 0x1908;
    pub const GL_UNSIGNED_BYTE: u32 = 0x1401;
    pub const GL_FRAMEBUFFER: u32 = 0x8d40;
    pub const GL_COLOR_ATTACHMENT0: u32 = 0x8ce0;
    pub const GL_FRAMEBUFFER_COMPLETE: u32 = 0x8cd5;
    pub const GL_TEXTURE_2D: u32 = 0x0de1;
    pub const GL_TEXTURE_MIN_FILTER: u32 = 0x2801;
    pub const GL_TEXTURE_MAG_FILTER: u32 = 0x2800;
    pub const GL_TEXTURE_WRAP_S: u32 = 0x2802;
    pub const GL_TEXTURE_WRAP_T: u32 = 0x2803;
    pub const GL_LINEAR: i32 = 0x2601;
    pub const GL_CLAMP_TO_EDGE: i32 = 0x812f;
}
use ffi::*;

fn egl_error(what: &str) -> io::Error {
    io::Error::other(format!("{what}: EGL error {:#x}", unsafe { eglGetError() }))
}

struct Card {
    file: File,
    /// Flips completed for CRTCs whose panel was not the one reading events,
    /// with the vblank time of each.
    completed: RefCell<Vec<(crtc::Handle, Duration)>>,
}
impl AsFd for Card {
    fn as_fd(&self) -> BorrowedFd<'_> {
        self.file.as_fd()
    }
}
impl Device for Card {}
impl ControlDevice for Card {}

/// A GBM front buffer as KMS sees it.
struct Scanout {
    size: [u32; 2],
    pitch: u32,
    handle: BufferHandle,
}
impl Buffer for Scanout {
    fn size(&self) -> (u32, u32) {
        (self.size[0], self.size[1])
    }
    fn format(&self) -> DrmFourcc {
        DrmFourcc::Xrgb8888
    }
    fn pitch(&self) -> u32 {
        self.pitch
    }
    fn handle(&self) -> BufferHandle {
        self.handle
    }
}

struct Panel {
    role: DisplayRole,
    size: [u32; 2],
    gbm: *mut gbm_surface,
    surface: EGLSurface,
    connector: connector::Handle,
    crtc: crtc::Handle,
    mode: Mode,
    old: crtc::Info,
    old_connectors: Vec<connector::Handle>,
    /// KMS framebuffers for the GBM buffers seen so far (a surface cycles a few).
    framebuffers: Vec<(*mut gbm_bo, framebuffer::Handle)>,
    front: Option<*mut gbm_bo>,
    pending: Option<*mut gbm_bo>,
    /// OMARCHY_POCKET_TIMING=content: a hash of rows of the frame last swapped
    drawn: u64,
    /// when the last flip landed (the vblank time of its event, CLOCK_MONOTONIC)
    landed: Duration,
    /// The first frame sets the CRTC and produces no flip event.
    flip_expected: bool,
    target: u64,
}

struct Shared {
    card: Rc<Card>,
    device: *mut gbm_device,
    display: EGLDisplay,
    context: EGLContext,
    panels: Vec<Panel>,
}

/// Panels (bit 0 the top, bit 1 the bottom) whose next present repeats the
/// frame they show: the flush keeps their buffers and queues no flip.
static HELD: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);

/// Marks the panels the next present leaves as they are.
pub fn hold(top: bool, bottom: bool) {
    HELD.store(u8::from(top) | (u8::from(bottom) << 1), std::sync::atomic::Ordering::Relaxed);
}

/// The renderer's view of EGL: the context and each panel's window surface.
pub struct Context {
    display: EGLDisplay,
    context: EGLContext,
    surfaces: Rc<Vec<EGLSurface>>,
}
// The renderer calls these on the program's one thread; the handles outlive it.
unsafe impl ContextAccess for Context {
    type NativeTarget = usize;
    fn ensure_current(&mut self) -> Result<(), RenderError> {
        if unsafe { eglGetCurrentContext() } == self.context {
            return Ok(());
        }
        let surface = self.surfaces[0];
        if unsafe { eglMakeCurrent(self.display, surface, surface, self.context) } == 1 {
            Ok(())
        } else {
            Err(RenderError::Failed)
        }
    }
    fn bind_target(&mut self, panel: &usize) -> Result<(), RenderError> {
        let surface = *self.surfaces.get(*panel).ok_or(RenderError::InvalidFrame)?;
        if unsafe { eglMakeCurrent(self.display, surface, surface, self.context) } == 1 {
            // an app's renderer leaves its framebuffer bound on the shared context
            unsafe { glBindFramebuffer(GL_FRAMEBUFFER, 0) };
            Ok(())
        } else {
            Err(RenderError::Failed)
        }
    }
}

type Driver = pocket_gles2::Renderer<Context>;

/// Glyph pages are 512 x 512 luminance-alpha textures (512 KB). The default
/// 4 MB holds eight, and a frame pins every page it draws from: a line of
/// pinyin candidates from the run-time CJK atlases (about 4,000 glyphs per
/// slot, 10 to 13 pages) needs more, or the frame fails. 32 MB is 64 pages.
const GLYPH_CACHE: pocket_gles::CacheLimits = pocket_gles::CacheLimits::new(512, 64 * 1024 * 1024, 128, 32 * 1024 * 1024);

/// Every holder declares `driver` before `shared`: fields drop in order, so
/// the GLES objects go while the EGL context and surfaces still exist.
pub struct Renderer {
    driver: Rc<RefCell<Driver>>,
    _shared: Rc<RefCell<Shared>>,
}
impl pocket_drivers::Renderer for Renderer {
    type Submission = pocket_gles::Submission;
    fn descriptor(&self) -> RendererDescriptor {
        pocket_drivers::Renderer::descriptor(&*self.driver.borrow())
    }
    fn render(&mut self, frame: &mut FrameInput<'_>) -> Result<Self::Submission, RenderError> {
        self.driver.borrow_mut().render(frame)
    }
    fn wait(&mut self, token: &Self::Submission) -> Result<(), RenderError> {
        self.driver.borrow_mut().wait(token)
    }
    fn retire(&mut self, token: Self::Submission) {
        self.driver.borrow_mut().retire(token);
    }
}

pub struct Display {
    driver: Rc<RefCell<Driver>>,
    shared: Rc<RefCell<Shared>>,
    index: usize,
    sequence: u64,
}

impl Shared {
    fn framebuffer(&mut self, index: usize, bo: *mut gbm_bo) -> io::Result<framebuffer::Handle> {
        let panel = &mut self.panels[index];
        if let Some((_, fb)) = panel.framebuffers.iter().find(|(b, _)| *b == bo) {
            return Ok(*fb);
        }
        let raw = unsafe { gbm_bo_get_handle(bo) } as u32;
        let handle = drm::control::from_u32::<BufferHandle>(raw)
            .ok_or_else(|| io::Error::other("GBM buffer has no KMS handle"))?;
        let scanout = Scanout {
            size: panel.size,
            pitch: unsafe { gbm_bo_get_stride(bo) },
            handle,
        };
        let fb = self.card.add_framebuffer(&scanout, 24, 32)?;
        panel.framebuffers.push((bo, fb));
        Ok(fb)
    }
    fn present(&mut self, index: usize) -> io::Result<()> {
        let (display, surface, gbm) = {
            let panel = &self.panels[index];
            (self.display, panel.surface, panel.gbm)
        };
        // Presentation renders every panel before flushing any, so another
        // panel's surface may be current; a swap needs its own.
        if unsafe { eglMakeCurrent(display, surface, surface, self.context) } != 1 {
            return Err(egl_error("eglMakeCurrent before swap"));
        }
        unsafe { glBindFramebuffer(GL_FRAMEBUFFER, 0) };
        capture(index, self.panels[index].size);
        let held = HELD.load(std::sync::atomic::Ordering::Relaxed) & (1 << index) != 0;
        if held && self.panels[index].front.is_some() {
            return Ok(());
        }
        let drawn = content_hash_gl(self.panels[index].size);
        let swap_started = Instant::now();
        if unsafe { eglSwapBuffers(display, surface) } != 1 {
            return Err(egl_error("eglSwapBuffers"));
        }
        probe(index, "swap", swap_started);
        let bo = unsafe { gbm_surface_lock_front_buffer(gbm) };
        if bo.is_null() {
            return Err(io::Error::other(
                "gbm_surface_lock_front_buffer returned no buffer",
            ));
        }
        let fb = self.framebuffer(index, bo)?;
        // The VOP2 consumes a config-done written in the first lines after
        // the port's frame start without taking the configuration: a flip
        // queued as soon as the previous one's event arrived was lost, and
        // the panel stayed a change behind. The write waits out that window.
        let since = monotonic().saturating_sub(self.panels[index].landed);
        if since < FLIP_GAP {
            std::thread::sleep(FLIP_GAP - since);
        }
        let panel = &mut self.panels[index];
        if let Some(drawn) = drawn {
            panel.drawn = drawn;
            eprintln!("omarchy-pocket-host: panel {index} flip fb={} bo={bo:?} drawn={drawn:016x}", u32::from(fb));
        }
        if panel.front.is_none() {
            self.card.set_crtc(
                panel.crtc,
                Some(fb),
                (0, 0),
                &[panel.connector],
                Some(panel.mode),
            )?;
            panel.flip_expected = false;
        } else {
            self.card
                .page_flip(panel.crtc, fb, PageFlipFlags::EVENT, None)?;
            panel.flip_expected = true;
        }
        panel.pending = Some(bo);
        Ok(())
    }
    fn complete(&mut self, index: usize) -> io::Result<()> {
        let wait_started = Instant::now();
        if self.panels[index].flip_expected {
            let crtc = self.panels[index].crtc;
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                {
                    let mut completed = self.card.completed.borrow_mut();
                    if let Some(at) = completed.iter().position(|c| c.0 == crtc) {
                        self.panels[index].landed = completed.swap_remove(at).1;
                        break;
                    }
                }
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "page flip did not complete",
                    ));
                }
                let mut descriptor = libc::pollfd {
                    fd: self.card.file.as_raw_fd(),
                    events: libc::POLLIN,
                    revents: 0,
                };
                let ready = unsafe {
                    libc::poll(&mut descriptor, 1, remaining.as_millis().min(1000) as i32)
                };
                if ready < 0 {
                    let e = io::Error::last_os_error();
                    if e.kind() == io::ErrorKind::Interrupted {
                        continue;
                    }
                    return Err(e);
                }
                if ready > 0 {
                    for event in self.card.receive_events()? {
                        if let Event::PageFlip(event) = event {
                            self.card.completed.borrow_mut().push((event.crtc, event.duration));
                        }
                    }
                }
            }
        }
        probe(index, "flip wait", wait_started);
        let panel = &mut self.panels[index];
        panel.flip_expected = false;
        if let Some(bo) = panel.pending.take() {
            if let Some(old) = panel.front.replace(bo) {
                unsafe { gbm_surface_release_buffer(panel.gbm, old) };
            }
            if content_on() {
                let scan = content_hash_bo(bo, panel.size);
                let verdict = if scan == Some(panel.drawn) { "same" } else { "DIFFERS" };
                eprintln!(
                    "omarchy-pocket-host: panel {index} shown bo={bo:?} scan={:016x} {verdict} drawn={:016x}",
                    scan.unwrap_or(0),
                    panel.drawn
                );
            }
        }
        Ok(())
    }
}

/// How long after a panel's flip lands its next flip may be queued: the
/// frame start's first 16 lines are 0.33 ms, the commit runs on a worker.
const FLIP_GAP: Duration = Duration::from_millis(2);

/// CLOCK_MONOTONIC, the clock of the flip events.
fn monotonic() -> Duration {
    let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut ts) };
    Duration::new(ts.tv_sec as u64, ts.tv_nsec as u32)
}

/// OMARCHY_POCKET_TIMING=frames: a presentation step over 4 ms, as it happens.
fn probe(index: usize, what: &str, started: Instant) {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    if !*ON.get_or_init(|| std::env::var_os("OMARCHY_POCKET_TIMING").is_some_and(|v| v == "frames")) {
        return;
    }
    let spent = started.elapsed();
    if spent > Duration::from_millis(4) {
        eprintln!("omarchy-pocket-host: panel {index} {what} {:.1} ms", spent.as_secs_f64() * 1000.0);
    }
}

/// OMARCHY_POCKET_TIMING=content: each flipped frame's content as a hash of
/// every fourth row, taken before the swap (what the renderer drew) and again once the
/// frame shows (what its buffer holds).
fn content_on() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("OMARCHY_POCKET_TIMING").is_some_and(|v| v == "content"))
}
/// Every fourth row: a line of text is at least four rows tall.
fn content_rows(height: u32) -> impl Iterator<Item = u32> {
    (0..height / 4).map(|i| i * 4 + 2)
}
/// FNV-1a over a pixel's red, green and blue.
fn content_mix(hash: &mut u64, rgb: [u8; 3]) {
    for byte in rgb {
        *hash ^= u64::from(byte);
        *hash = hash.wrapping_mul(0x100000001b3);
    }
}
/// The rows as the GPU drew them: GL reads bottom row first.
fn content_hash_gl(size: [u32; 2]) -> Option<u64> {
    if !content_on() {
        return None;
    }
    let pitch = size[0] as usize * 4;
    let mut pixels = vec![0u8; pitch * size[1] as usize];
    unsafe {
        glReadPixels(0, 0, size[0] as i32, size[1] as i32, GL_RGBA, GL_UNSIGNED_BYTE, pixels.as_mut_ptr().cast())
    };
    let mut hash = 0xcbf29ce484222325u64;
    for y in content_rows(size[1]) {
        let row = &pixels[(size[1] as usize - 1 - y as usize) * pitch..][..pitch];
        for px in row.chunks_exact(4).step_by(4) {
            content_mix(&mut hash, [px[0], px[1], px[2]]);
        }
    }
    Some(hash)
}
/// The rows as the buffer holds them (XRGB8888: blue first).
fn content_hash_bo(bo: *mut gbm_bo, size: [u32; 2]) -> Option<u64> {
    let mut stride = 0u32;
    let mut map_data: *mut c_void = ptr::null_mut();
    let base = unsafe { gbm_bo_map(bo, 0, 0, size[0], size[1], 1, &mut stride, &mut map_data) };
    if base.is_null() {
        return None;
    }
    let mut hash = 0xcbf29ce484222325u64;
    for y in content_rows(size[1]) {
        let row = unsafe {
            std::slice::from_raw_parts(base.cast::<u8>().add(y as usize * stride as usize), size[0] as usize * 4)
        };
        for px in row.chunks_exact(4).step_by(4) {
            content_mix(&mut hash, [px[2], px[1], px[0]]);
        }
    }
    unsafe { gbm_bo_unmap(bo, map_data) };
    Some(hash)
}

/// While /tmp/pocket-shot exists, each presented frame is read back from the
/// GPU before its swap into /tmp/pocket-shot-<panel>.rgba (bottom row first,
/// as GL reads); the trigger goes once both panels have a file. Remove old
/// files before touching the trigger.
fn capture(index: usize, size: [u32; 2]) {
    const TRIGGER: &str = "/tmp/pocket-shot";
    if !Path::new(TRIGGER).exists() {
        return;
    }
    let mut pixels = vec![0u8; size[0] as usize * size[1] as usize * 4];
    unsafe {
        glReadPixels(
            0,
            0,
            size[0] as i32,
            size[1] as i32,
            GL_RGBA,
            GL_UNSIGNED_BYTE,
            pixels.as_mut_ptr().cast(),
        );
    }
    let file = format!("/tmp/pocket-shot-{index}.rgba");
    let _ = std::fs::write(&file, &pixels);
    // An unchanged panel is not presented: the trigger stays until both have a frame.
    if (0..2).all(|panel| Path::new(&format!("/tmp/pocket-shot-{panel}.rgba")).exists()) {
        let _ = std::fs::remove_file(TRIGGER);
    }
}

impl DisplayOutput for Display {
    type Token = u64;
    fn descriptor(&self) -> DisplayDescriptor {
        let shared = self.shared.borrow();
        let panel = &shared.panels[self.index];
        let mut d = DisplayDescriptor::new(
            panel.role,
            panel.size[0],
            panel.size[1],
            PixelFormat::Rgba8888,
            panel.size[0] as usize * 4,
            TargetOwnership::DeviceOwned,
        );
        d.double_buffered = true;
        d.vsync = VsyncSource::Display;
        d
    }
    fn acquire(&mut self, region: Rect) -> Result<Target<'_>, DisplayError> {
        // the previous frame's flip, queued by the last present
        if self.shared.borrow().panels[self.index].pending.is_some() {
            self.shared.borrow_mut().complete(self.index).map_err(|e| {
                eprintln!("omarchy-pocket-host: panel {} flip: {e}", self.index);
                DisplayError::Failed
            })?;
        }
        let shared = self.shared.borrow();
        let panel = &shared.panels[self.index];
        if region != Rect::new(0, 0, panel.size[0], panel.size[1]) {
            return Err(DisplayError::InvalidTarget);
        }
        self.driver
            .borrow()
            .target(panel.target)
            .map(Target::DeviceOwned)
            .map_err(|_| DisplayError::Failed)
    }
    fn flush(&mut self, _: &[Rect]) -> Result<u64, DisplayError> {
        self.shared.borrow_mut().present(self.index).map_err(|e| {
            eprintln!("omarchy-pocket-host: panel {} present: {e}", self.index);
            DisplayError::Failed
        })?;
        self.sequence += 1;
        Ok(self.sequence)
    }
    /// The flip completes at the next acquire (or when the panels close).
    fn wait(&mut self, token: u64) -> Result<(), DisplayError> {
        if token != self.sequence {
            return Err(DisplayError::InvalidTarget);
        }
        Ok(())
    }
    fn vsync(&mut self) -> VsyncSource {
        VsyncSource::Display
    }
}

impl Drop for Shared {
    fn drop(&mut self) {
        // a queued flip finishes before the CRTCs go back to the old framebuffers
        for index in 0..self.panels.len() {
            if self.panels[index].pending.is_some() {
                let _ = self.complete(index);
            }
        }
        unsafe {
            eglMakeCurrent(
                self.display,
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null_mut(),
            );
        }
        for panel in self.panels.drain(..) {
            if self
                .card
                .set_crtc(
                    panel.crtc,
                    panel.old.framebuffer(),
                    panel.old.position(),
                    &panel.old_connectors,
                    panel.old.mode(),
                )
                .is_err()
            {
                let _ = self.card.set_crtc(panel.crtc, None, (0, 0), &[], None);
            }
            for (_, fb) in &panel.framebuffers {
                let _ = self.card.destroy_framebuffer(*fb);
            }
            unsafe {
                for bo in [panel.front, panel.pending].into_iter().flatten() {
                    gbm_surface_release_buffer(panel.gbm, bo);
                }
                eglDestroySurface(self.display, panel.surface);
                gbm_surface_destroy(panel.gbm);
            }
        }
        unsafe {
            eglDestroyContext(self.display, self.context);
            eglTerminate(self.display);
            gbm_device_destroy(self.device);
        }
    }
}

/// A panel to open: its connector's name (`DSI-1`), size and surface role.
pub struct PanelSpec<'a> {
    pub connector: &'a str,
    pub size: [u32; 2],
    pub role: DisplayRole,
}

/// The card, GBM, EGL and a GLES 2 renderer for the panels, in order.
pub fn open(
    path: impl AsRef<Path>,
    specs: &[PanelSpec<'_>],
) -> io::Result<(Renderer, Vec<Display>, Compositor)> {
    let card = Rc::new(Card {
        file: OpenOptions::new().read(true).write(true).open(path)?,
        completed: RefCell::new(Vec::new()),
    });
    let device = unsafe { gbm_create_device(card.file.as_raw_fd()) };
    if device.is_null() {
        return Err(io::Error::other("gbm_create_device failed"));
    }
    let get_display: GetPlatformDisplay = unsafe {
        let proc = eglGetProcAddress(c"eglGetPlatformDisplayEXT".as_ptr());
        if proc.is_null() {
            gbm_device_destroy(device);
            return Err(io::Error::other("EGL lacks eglGetPlatformDisplayEXT"));
        }
        std::mem::transmute::<*mut c_void, GetPlatformDisplay>(proc)
    };
    let display = unsafe { get_display(EGL_PLATFORM_GBM_KHR, device.cast(), ptr::null()) };
    let (mut major, mut minor) = (0, 0);
    if display.is_null() || unsafe { eglInitialize(display, &mut major, &mut minor) } != 1 {
        unsafe { gbm_device_destroy(device) };
        return Err(egl_error("EGL on GBM"));
    }
    unsafe { eglBindAPI(EGL_OPENGL_ES_API) };
    // A window config whose native visual is the scanout format.
    let attributes = [
        EGL_SURFACE_TYPE,
        EGL_WINDOW_BIT,
        EGL_RENDERABLE_TYPE,
        EGL_OPENGL_ES2_BIT,
        EGL_RED_SIZE,
        8,
        EGL_GREEN_SIZE,
        8,
        EGL_BLUE_SIZE,
        8,
        EGL_ALPHA_SIZE,
        0,
        EGL_NONE,
    ];
    let mut configs = [ptr::null_mut(); 64];
    let mut count = 0;
    unsafe {
        eglChooseConfig(
            display,
            attributes.as_ptr(),
            configs.as_mut_ptr(),
            64,
            &mut count,
        )
    };
    let config = configs[..count.max(0) as usize]
        .iter()
        .copied()
        .find(|config| {
            let mut visual = 0;
            let known =
                unsafe { eglGetConfigAttrib(display, *config, EGL_NATIVE_VISUAL_ID, &mut visual) };
            known == 1 && visual as u32 == GBM_FORMAT_XRGB8888
        });
    let fail = |what: &str| {
        let error = egl_error(what);
        unsafe {
            eglTerminate(display);
            gbm_device_destroy(device);
        }
        error
    };
    let Some(config) = config else {
        return Err(fail("no EGL window config with the XRGB8888 visual"));
    };
    let version = [EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE];
    let context = unsafe { eglCreateContext(display, config, ptr::null_mut(), version.as_ptr()) };
    if context.is_null() {
        return Err(fail("eglCreateContext"));
    }
    let create_surface: Option<CreatePlatformWindowSurface> = unsafe {
        let proc = eglGetProcAddress(c"eglCreatePlatformWindowSurfaceEXT".as_ptr());
        (!proc.is_null())
            .then(|| std::mem::transmute::<*mut c_void, CreatePlatformWindowSurface>(proc))
    };
    let mut shared = Shared {
        card: card.clone(),
        device,
        display,
        context,
        panels: Vec::new(),
    };
    let mut taken = Vec::new();
    let resources = card.resource_handles()?;
    for spec in specs {
        let selection =
            pocket_linux_drm::select_output(&*card, spec.size, Some(spec.connector), &taken)?;
        taken.push(selection.crtc);
        let old = card.get_crtc(selection.crtc)?;
        let mut old_connectors = Vec::new();
        for handle in resources.connectors() {
            let c = card.get_connector(*handle, false)?;
            if c.current_encoder()
                .and_then(|e| card.get_encoder(e).ok())
                .and_then(|e| e.crtc())
                == Some(selection.crtc)
            {
                old_connectors.push(*handle);
            }
        }
        let gbm = unsafe {
            gbm_surface_create(
                device,
                spec.size[0],
                spec.size[1],
                GBM_FORMAT_XRGB8888,
                GBM_BO_USE_SCANOUT | GBM_BO_USE_RENDERING,
            )
        };
        if gbm.is_null() {
            return Err(io::Error::other(format!(
                "gbm_surface_create for {}",
                spec.connector
            )));
        }
        let surface = unsafe {
            match create_surface {
                Some(create) => create(display, config, gbm.cast(), ptr::null()),
                None => eglCreateWindowSurface(display, config, gbm.cast(), ptr::null()),
            }
        };
        if surface.is_null() {
            unsafe { gbm_surface_destroy(gbm) };
            return Err(egl_error(&format!(
                "EGL window surface for {}",
                spec.connector
            )));
        }
        shared.panels.push(Panel {
            role: spec.role,
            size: spec.size,
            gbm,
            surface,
            connector: selection.connector,
            crtc: selection.crtc,
            mode: selection.mode,
            old,
            old_connectors,
            framebuffers: Vec::new(),
            front: None,
            pending: None,
            drawn: 0,
            landed: Duration::ZERO,
            flip_expected: false,
            target: 0,
        });
    }
    let surfaces = Rc::new(shared.panels.iter().map(|p| p.surface).collect::<Vec<_>>());
    if unsafe { eglMakeCurrent(display, surfaces[0], surfaces[0], context) } != 1 {
        return Err(egl_error("eglMakeCurrent"));
    }
    unsafe { eglSwapInterval(display, 0) };
    let mut driver = Driver::with_limits(
        Context {
            display,
            context,
            surfaces: surfaces.clone(),
        },
        GLYPH_CACHE,
    )
    .map_err(|e| io::Error::other(format!("GLES renderer: {e:?}")))?;
    for (index, panel) in shared.panels.iter_mut().enumerate() {
        let window = panel.size;
        panel.target = driver
            .register_target(TargetConfig::new(
                index,
                window,
                Viewport::new(0, 0, window[0], window[1]),
                PixelFormat::Rgba8888,
            ))
            .map_err(|e| io::Error::other(format!("GLES target: {e:?}")))?;
    }
    eprintln!(
        "display: GBM/EGL {major}.{minor}, GLES 2 renderer on {} panels",
        shared.panels.len()
    );
    let driver = Rc::new(RefCell::new(driver));
    let shared = Rc::new(RefCell::new(shared));
    let displays = (0..specs.len())
        .map(|index| Display {
            driver: driver.clone(),
            shared: shared.clone(),
            index,
            sequence: 0,
        })
        .collect();
    let compositor = Compositor {
        shell: driver.clone(),
        display,
        context,
        surface: surfaces[0],
        _shared: shared.clone(),
    };
    Ok((
        Renderer {
            driver,
            _shared: shared,
        },
        displays,
        compositor,
    ))
}

// ---- apps in windows ---------------------------------------------------------

/// The pocket apps in the shell's windows, on the GPU. Each app renders its
/// displays into its own textures (a framebuffer each) with its own GLES
/// renderer on the shell's EGL context; the shell's renderer draws a texture
/// wherever the shell draws the core texture bound to it (`bind`), in the
/// shell's paint order, with no copy.
pub struct Compositor {
    shell: Rc<RefCell<Driver>>,
    display: EGLDisplay,
    context: EGLContext,
    /// any window surface, to make the context current between panel draws
    surface: EGLSurface,
    _shared: Rc<RefCell<Shared>>,
}

/// An app's GPU side: one texture and framebuffer per display, the renderer
/// that draws into them, and the displays its Runtime presents to.
pub struct AppGpu {
    pub renderer: AppRenderer,
    pub displays: Vec<AppDisplay>,
    /// the GL texture of each display, in order; they live as long as the
    /// renderer (the app's Runtime owns it)
    pub textures: Vec<u32>,
    /// what resizes each display, kept by the host
    pub sizes: Vec<AppSize>,
}

/// Resizes one app display: the texture keeps its GL name (the shell's
/// binding stays), its storage and the renderer's target take the new size,
/// and the display reports it to the Runtime's next refresh.
pub struct AppSize {
    driver: Rc<RefCell<AppDriver>>,
    index: usize,
    texture: u32,
    size: Rc<Cell<[u32; 2]>>,
    target: Rc<Cell<u64>>,
    targets: Rc<AppTargets>,
}

impl AppSize {
    pub fn get(&self) -> [u32; 2] {
        self.size.get()
    }

    pub fn set(&self, size: [u32; 2]) -> io::Result<()> {
        let t = &self.targets;
        unsafe {
            if eglMakeCurrent(t.display, t.surface, t.surface, t.context) != 1 {
                return Err(egl_error("eglMakeCurrent to resize an app"));
            }
            glBindTexture(GL_TEXTURE_2D, self.texture);
            glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA as i32, size[0] as i32, size[1] as i32, 0, GL_RGBA, GL_UNSIGNED_BYTE, ptr::null());
            glBindTexture(GL_TEXTURE_2D, 0);
        }
        let mut driver = self.driver.borrow_mut();
        let _ = driver.unregister_target(self.target.get());
        let target = driver
            .register_target(TargetConfig::new(self.index, size, Viewport::new(0, 0, size[0], size[1]), PixelFormat::Rgba8888))
            .map_err(|e| io::Error::other(format!("app target: {e:?}")))?;
        self.target.set(target);
        self.size.set(size);
        Ok(())
    }
}

struct AppTargets {
    display: EGLDisplay,
    context: EGLContext,
    surface: EGLSurface,
    framebuffers: Vec<u32>,
    textures: Vec<u32>,
}

impl Drop for AppTargets {
    fn drop(&mut self) {
        unsafe {
            eglMakeCurrent(self.display, self.surface, self.surface, self.context);
            glBindFramebuffer(GL_FRAMEBUFFER, 0);
            glDeleteFramebuffers(self.framebuffers.len() as i32, self.framebuffers.as_ptr());
            glDeleteTextures(self.textures.len() as i32, self.textures.as_ptr());
        }
    }
}

/// The app renderer's view of EGL: the shared context, its framebuffers.
pub struct AppContext {
    targets: Rc<AppTargets>,
}
unsafe impl ContextAccess for AppContext {
    type NativeTarget = usize;
    fn ensure_current(&mut self) -> Result<(), RenderError> {
        let t = &self.targets;
        if unsafe { eglGetCurrentContext() } == t.context || unsafe { eglMakeCurrent(t.display, t.surface, t.surface, t.context) } == 1 {
            Ok(())
        } else {
            Err(RenderError::Failed)
        }
    }
    fn bind_target(&mut self, index: &usize) -> Result<(), RenderError> {
        self.ensure_current()?;
        let framebuffer = *self.targets.framebuffers.get(*index).ok_or(RenderError::InvalidFrame)?;
        unsafe { glBindFramebuffer(GL_FRAMEBUFFER, framebuffer) };
        Ok(())
    }
}

type AppDriver = pocket_gles2::Renderer<AppContext>;

/// An app's glyph and image caches: smaller than the shell's, an app is one window.
const APP_CACHE: pocket_gles::CacheLimits = pocket_gles::CacheLimits::new(256, 24 * 1024 * 1024, 64, 12 * 1024 * 1024);

pub struct AppRenderer {
    driver: Rc<RefCell<AppDriver>>,
    _targets: Rc<AppTargets>,
}
impl pocket_drivers::Renderer for AppRenderer {
    type Submission = pocket_gles::Submission;
    fn descriptor(&self) -> RendererDescriptor {
        pocket_drivers::Renderer::descriptor(&*self.driver.borrow())
    }
    fn render(&mut self, frame: &mut FrameInput<'_>) -> Result<Self::Submission, RenderError> {
        self.driver.borrow_mut().render(frame)
    }
    fn wait(&mut self, token: &Self::Submission) -> Result<(), RenderError> {
        self.driver.borrow_mut().wait(token)
    }
    fn retire(&mut self, token: Self::Submission) {
        self.driver.borrow_mut().retire(token);
    }
}

/// A display of an app that lands in a texture: nothing to swap or flip.
pub struct AppDisplay {
    driver: Rc<RefCell<AppDriver>>,
    role: DisplayRole,
    size: Rc<Cell<[u32; 2]>>,
    target: Rc<Cell<u64>>,
    sequence: u64,
}

impl DisplayOutput for AppDisplay {
    type Token = u64;
    fn descriptor(&self) -> DisplayDescriptor {
        let size = self.size.get();
        let mut d = DisplayDescriptor::new(self.role, size[0], size[1], PixelFormat::Rgba8888, size[0] as usize * 4, TargetOwnership::DeviceOwned);
        d.vsync = VsyncSource::None;
        d
    }
    fn acquire(&mut self, region: Rect) -> Result<Target<'_>, DisplayError> {
        let size = self.size.get();
        if region != Rect::new(0, 0, size[0], size[1]) {
            return Err(DisplayError::InvalidTarget);
        }
        self.driver.borrow().target(self.target.get()).map(Target::DeviceOwned).map_err(|_| DisplayError::Failed)
    }
    fn flush(&mut self, _: &[Rect]) -> Result<u64, DisplayError> {
        self.sequence += 1;
        Ok(self.sequence)
    }
    fn wait(&mut self, token: u64) -> Result<(), DisplayError> {
        if token != self.sequence {
            return Err(DisplayError::InvalidTarget);
        }
        Ok(())
    }
    fn vsync(&mut self) -> VsyncSource {
        VsyncSource::None
    }
}

impl Compositor {
    /// Textures, framebuffers and a renderer for an app with displays of
    /// `sizes` (physical pixels: logical size times density), in role order.
    pub fn app(&self, sizes: &[(DisplayRole, [u32; 2])]) -> io::Result<AppGpu> {
        unsafe {
            if eglMakeCurrent(self.display, self.surface, self.surface, self.context) != 1 {
                return Err(egl_error("eglMakeCurrent for an app"));
            }
        }
        let mut textures = vec![0u32; sizes.len()];
        let mut framebuffers = vec![0u32; sizes.len()];
        unsafe {
            glGenTextures(sizes.len() as i32, textures.as_mut_ptr());
            glGenFramebuffers(sizes.len() as i32, framebuffers.as_mut_ptr());
        }
        let targets = Rc::new(AppTargets { display: self.display, context: self.context, surface: self.surface, framebuffers: framebuffers.clone(), textures: textures.clone() });
        for (i, (_, size)) in sizes.iter().enumerate() {
            unsafe {
                glBindTexture(GL_TEXTURE_2D, textures[i]);
                glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA as i32, size[0] as i32, size[1] as i32, 0, GL_RGBA, GL_UNSIGNED_BYTE, ptr::null());
                glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
                glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
                glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
                glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
                glBindFramebuffer(GL_FRAMEBUFFER, framebuffers[i]);
                glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, textures[i], 0);
                let status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
                glBindFramebuffer(GL_FRAMEBUFFER, 0);
                glBindTexture(GL_TEXTURE_2D, 0);
                if status != GL_FRAMEBUFFER_COMPLETE {
                    return Err(io::Error::other(format!("app framebuffer incomplete: {status:#x}")));
                }
            }
        }
        let mut driver = AppDriver::with_limits(AppContext { targets: targets.clone() }, APP_CACHE)
            .map_err(|e| io::Error::other(format!("app renderer: {e:?}")))?;
        let mut handles = Vec::new();
        for (i, (_, size)) in sizes.iter().enumerate() {
            handles.push(
                driver
                    .register_target(TargetConfig::new(i, *size, Viewport::new(0, 0, size[0], size[1]), PixelFormat::Rgba8888))
                    .map_err(|e| io::Error::other(format!("app target: {e:?}")))?,
            );
        }
        let driver = Rc::new(RefCell::new(driver));
        let cells: Vec<_> = sizes.iter().zip(&handles).map(|((_, size), target)| (Rc::new(Cell::new(*size)), Rc::new(Cell::new(*target)))).collect();
        let displays = sizes
            .iter()
            .zip(&cells)
            .map(|((role, _), (size, target))| AppDisplay { driver: driver.clone(), role: *role, size: size.clone(), target: target.clone(), sequence: 0 })
            .collect();
        let resizers = cells
            .iter()
            .enumerate()
            .map(|(index, (size, target))| AppSize { driver: driver.clone(), index, texture: textures[index], size: size.clone(), target: target.clone(), targets: targets.clone() })
            .collect();
        Ok(AppGpu { renderer: AppRenderer { driver, _targets: targets }, displays, textures, sizes: resizers })
    }

    /// Draws GL texture `texture` wherever the shell draws core texture `handle`; None ends it.
    pub fn bind(&self, handle: i32, texture: Option<u32>) {
        self.shell.borrow_mut().set_external_texture(handle, texture);
    }
}

