//! GPU presentation on the RG DS Plus: Rockchip libmali's GBM and EGL on the
//! KMS card (Mali-G52, kbase driver; the kernel has no Panfrost), GLES 2
//! rendering through pocket-gles2, one GBM surface and EGL window surface per
//! panel, one EGL context for both. A flush swaps the panel's surface, adds
//! its front buffer to KMS once and page-flips it. The flip completes at the
//! panel's next acquire (taking the flip event for its CRTC and returning the
//! previous front buffer to GBM), not inside the present that queued it: a
//! present costs its rendering, and the flip lands while the next tick runs.
//! A panel whose draw list did not change (`hold`) is rendered but neither
//! swapped nor flipped, so it keeps showing its frame.
//!
//! EGL, GLES and GBM all come from libmali.so.1, which the program links
//! directly: libmali's libEGL/libGLESv2/libgbm are small wrappers that export
//! none of those symbols themselves (egl.rs). The apps in the shell's windows
//! render through compositor.rs on this context.
use drm::{
    buffer::{Buffer, DrmFourcc, Handle as BufferHandle},
    control::{connector, crtc, framebuffer, Device as ControlDevice, Event, Mode, PageFlipFlags},
    Device,
};
use pocket_drivers::*;
use pocket_gles::{ContextAccess, TargetConfig, Viewport};
use std::{
    cell::RefCell,
    ffi::{c_int, c_void},
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
    pub enum gbm_device {}
    pub enum gbm_surface {}
    pub enum gbm_bo {}
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
}
use crate::compositor::Compositor;
use crate::egl::*;
use ffi::*;

struct Card {
    file: File,
    /// Flips completed for CRTCs whose panel was not the one reading events.
    completed: RefCell<Vec<crtc::Handle>>,
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
                    if let Some(at) = completed.iter().position(|c| *c == crtc) {
                        completed.swap_remove(at);
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
                            self.card.completed.borrow_mut().push(event.crtc);
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
    let shell = driver.clone();
    let compositor = Compositor::new(
        Box::new(move |handle, texture| shell.borrow_mut().set_external_texture(handle, texture)),
        display,
        context,
        surfaces[0],
        shared.clone(),
    );
    Ok((
        Renderer {
            driver,
            _shared: shared,
        },
        displays,
        compositor,
    ))
}
