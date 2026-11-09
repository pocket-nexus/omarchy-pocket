//! GPU presentation on the AYN Thor: the platform's EGL and GLES 2 (Adreno
//! 740), one EGL window surface per display on the ANativeWindow of the
//! app's SurfaceView there (the upper display in the activity, the lower one
//! in a Presentation), one EGL context for both, rendered by pocket-gles2.
//!
//! Android owns the windows: a SurfaceView's surface comes and goes with the
//! activity (`attach`, `detach`), so the context also holds a 1x1 pbuffer,
//! which keeps it current while a display has no window: texture uploads,
//! glyph atlases and the apps in the shell's windows need a current context
//! whatever the windows do. A display without a window (the lower display
//! switched off, the activity in the background) renders into the pbuffer
//! and swaps nothing, so the other display goes on; the run loop presents
//! while either display has a window.
//!
//! A flush swaps that display's surface with a swap interval of 0: the
//! BufferQueue takes the frame without waiting for the display's vsync, and
//! SurfaceFlinger shows the newest one, so a 60 Hz loop never blocks on a
//! 120 Hz display. A display whose draw list did not change (`hold`) is
//! rendered but not swapped, and keeps showing its frame.
use crate::compositor::Compositor;
use crate::egl::*;
use pocket_drivers::*;
use pocket_gles::{ContextAccess, TargetConfig, Viewport};
use std::{cell::RefCell, ffi::c_void, io, ptr, rc::Rc};

#[allow(non_camel_case_types)]
pub enum ANativeWindow {}

#[link(name = "android")]
unsafe extern "C" {
    pub fn ANativeWindow_release(window: *mut ANativeWindow);
    fn ANativeWindow_setBuffersGeometry(window: *mut ANativeWindow, width: i32, height: i32, format: i32) -> i32;
}

/// Panels (bit 0 the upper display, bit 1 the lower) whose next present
/// repeats the frame they show: the flush keeps their buffers.
static HELD: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);

/// Marks the displays the next present leaves as they are.
pub fn hold(top: bool, bottom: bool) {
    HELD.store(u8::from(top) | (u8::from(bottom) << 1), std::sync::atomic::Ordering::Relaxed);
}

struct Panel {
    role: DisplayRole,
    size: [u32; 2],
    /// the window and its surface while Android lends one
    window: *mut ANativeWindow,
    surface: EGLSurface,
    target: u64,
    /// a frame has been swapped onto this window since it arrived
    shown: bool,
}

struct Shared {
    display: EGLDisplay,
    config: EGLConfig,
    context: EGLContext,
    /// keeps the context current while the displays have no windows
    pbuffer: EGLSurface,
    panels: Vec<Panel>,
}

impl Drop for Shared {
    fn drop(&mut self) {
        unsafe {
            eglMakeCurrent(self.display, ptr::null_mut(), ptr::null_mut(), ptr::null_mut());
            for panel in self.panels.drain(..) {
                if !panel.surface.is_null() {
                    eglDestroySurface(self.display, panel.surface);
                }
                if !panel.window.is_null() {
                    ANativeWindow_release(panel.window);
                }
            }
            eglDestroySurface(self.display, self.pbuffer);
            eglDestroyContext(self.display, self.context);
            eglTerminate(self.display);
        }
    }
}

/// The renderer's view of EGL: the context, each display's window surface
/// (or the pbuffer while it has none).
pub struct Context {
    shared: Rc<RefCell<Shared>>,
}

unsafe impl ContextAccess for Context {
    type NativeTarget = usize;
    fn ensure_current(&mut self) -> Result<(), RenderError> {
        let s = self.shared.borrow();
        if unsafe { eglGetCurrentContext() } == s.context {
            return Ok(());
        }
        if unsafe { eglMakeCurrent(s.display, s.pbuffer, s.pbuffer, s.context) } == 1 {
            Ok(())
        } else {
            Err(RenderError::Failed)
        }
    }
    fn bind_target(&mut self, panel: &usize) -> Result<(), RenderError> {
        let s = self.shared.borrow();
        let surface = s.panels.get(*panel).ok_or(RenderError::InvalidFrame)?.surface;
        // a display without a window draws into the 1x1 pbuffer: nothing shows it
        let surface = if surface.is_null() { s.pbuffer } else { surface };
        if unsafe { eglMakeCurrent(s.display, surface, surface, s.context) } == 1 {
            // an app's renderer leaves its framebuffer bound on the shared context
            unsafe { glBindFramebuffer(GL_FRAMEBUFFER, 0) };
            Ok(())
        } else {
            Err(RenderError::Failed)
        }
    }
}

type Driver = pocket_gles2::Renderer<Context>;

/// Glyph pages are 512 x 512 luminance-alpha textures (512 KB); a line of
/// pinyin candidates from the run-time CJK atlases pins 10 to 13 pages, and
/// density 3 glyphs take more of a page than the RG DS Plus's density 2. 48
/// MB is 96 pages.
const GLYPH_CACHE: pocket_gles::CacheLimits = pocket_gles::CacheLimits::new(512, 96 * 1024 * 1024, 128, 48 * 1024 * 1024);

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

impl DisplayOutput for Display {
    type Token = u64;
    fn descriptor(&self) -> DisplayDescriptor {
        let shared = self.shared.borrow();
        let panel = &shared.panels[self.index];
        let mut d = DisplayDescriptor::new(panel.role, panel.size[0], panel.size[1], PixelFormat::Rgba8888, panel.size[0] as usize * 4, TargetOwnership::DeviceOwned);
        d.double_buffered = true;
        d.vsync = VsyncSource::Display;
        d
    }
    fn acquire(&mut self, region: Rect) -> Result<Target<'_>, DisplayError> {
        let shared = self.shared.borrow();
        let panel = &shared.panels[self.index];
        if region != Rect::new(0, 0, panel.size[0], panel.size[1]) {
            return Err(DisplayError::InvalidTarget);
        }
        self.driver.borrow().target(panel.target).map(Target::DeviceOwned).map_err(|_| DisplayError::Failed)
    }
    fn flush(&mut self, _: &[Rect]) -> Result<u64, DisplayError> {
        let mut shared = self.shared.borrow_mut();
        let (display, context) = (shared.display, shared.context);
        let panel = &mut shared.panels[self.index];
        let held = HELD.load(std::sync::atomic::Ordering::Relaxed) & (1 << self.index) != 0;
        if !(held && panel.shown) && !panel.surface.is_null() {
            unsafe {
                // presentation renders every display before flushing any
                if eglMakeCurrent(display, panel.surface, panel.surface, context) != 1 {
                    eprintln!("omarchy-pocket: display {} make current: EGL error {:#x}", self.index, eglGetError());
                    return Err(DisplayError::Failed);
                }
                if eglSwapBuffers(display, panel.surface) != 1 {
                    eprintln!("omarchy-pocket: display {} swap: EGL error {:#x}", self.index, eglGetError());
                    return Err(DisplayError::Failed);
                }
            }
            panel.shown = true;
        }
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
        VsyncSource::Display
    }
}

/// The displays' windows, for the run loop: Android lends and takes them.
#[derive(Clone)]
pub struct Windows {
    shared: Rc<RefCell<Shared>>,
}

impl Windows {
    /// Puts the display on `window` (one reference, which this takes). The
    /// window's buffers are the display's size; SurfaceFlinger scales them
    /// to the view.
    pub fn attach(&self, index: usize, window: *mut ANativeWindow) -> io::Result<()> {
        self.detach(index);
        let mut s = self.shared.borrow_mut();
        let (display, config, context, pbuffer) = (s.display, s.config, s.context, s.pbuffer);
        let panel = &mut s.panels[index];
        unsafe {
            // WINDOW_FORMAT_RGBX_8888
            ANativeWindow_setBuffersGeometry(window, panel.size[0] as i32, panel.size[1] as i32, 2);
            let surface = eglCreateWindowSurface(display, config, window.cast::<c_void>(), ptr::null());
            if surface.is_null() {
                ANativeWindow_release(window);
                return Err(egl_error("EGL window surface"));
            }
            eglMakeCurrent(display, surface, surface, context);
            eglSwapInterval(display, 0);
            eglMakeCurrent(display, pbuffer, pbuffer, context);
            panel.window = window;
            panel.surface = surface;
            panel.shown = false;
        }
        Ok(())
    }

    /// Takes the display off its window, which Android is about to destroy.
    pub fn detach(&self, index: usize) {
        let mut s = self.shared.borrow_mut();
        let (display, context, pbuffer) = (s.display, s.context, s.pbuffer);
        let panel = &mut s.panels[index];
        if panel.surface.is_null() {
            return;
        }
        unsafe {
            eglMakeCurrent(display, pbuffer, pbuffer, context);
            eglDestroySurface(display, panel.surface);
            ANativeWindow_release(panel.window);
        }
        panel.surface = ptr::null_mut();
        panel.window = ptr::null_mut();
        panel.shown = false;
    }

    /// Whether this display has a window to present to.
    pub fn shown(&self, index: usize) -> bool {
        !self.shared.borrow().panels[index].surface.is_null()
    }

    /// Whether any display has a window to present to.
    pub fn any(&self) -> bool {
        self.shared.borrow().panels.iter().any(|p| !p.surface.is_null())
    }
}

/// EGL on Android's default display, a GLES 2 renderer for displays of
/// these physical sizes (in role order), none of them on a window yet.
pub fn open(specs: &[(DisplayRole, [u32; 2])]) -> io::Result<(Renderer, Vec<Display>, Compositor, Windows)> {
    let display = unsafe { eglGetDisplay(ptr::null_mut()) };
    let (mut major, mut minor) = (0, 0);
    if display.is_null() || unsafe { eglInitialize(display, &mut major, &mut minor) } != 1 {
        return Err(egl_error("eglInitialize"));
    }
    unsafe { eglBindAPI(EGL_OPENGL_ES_API) };
    let attributes = [
        EGL_SURFACE_TYPE, EGL_WINDOW_BIT | EGL_PBUFFER_BIT,
        EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
        EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_ALPHA_SIZE, 0,
        EGL_NONE,
    ];
    let mut config = ptr::null_mut();
    let mut count = 0;
    if unsafe { eglChooseConfig(display, attributes.as_ptr(), &mut config, 1, &mut count) } != 1 || count < 1 {
        unsafe { eglTerminate(display) };
        return Err(egl_error("no RGB888 window and pbuffer config"));
    }
    let version = [EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE];
    let context = unsafe { eglCreateContext(display, config, ptr::null_mut(), version.as_ptr()) };
    if context.is_null() {
        unsafe { eglTerminate(display) };
        return Err(egl_error("eglCreateContext"));
    }
    let one = [EGL_WIDTH, 1, EGL_HEIGHT, 1, EGL_NONE];
    let pbuffer = unsafe { eglCreatePbufferSurface(display, config, one.as_ptr()) };
    if pbuffer.is_null() || unsafe { eglMakeCurrent(display, pbuffer, pbuffer, context) } != 1 {
        unsafe {
            eglDestroyContext(display, context);
            eglTerminate(display);
        }
        return Err(egl_error("pbuffer"));
    }
    let panels = specs
        .iter()
        .map(|&(role, size)| Panel { role, size, window: ptr::null_mut(), surface: ptr::null_mut(), target: 0, shown: false })
        .collect();
    let shared = Rc::new(RefCell::new(Shared { display, config, context, pbuffer, panels }));
    let mut driver = Driver::with_limits(Context { shared: shared.clone() }, GLYPH_CACHE).map_err(|e| io::Error::other(format!("GLES renderer: {e:?}")))?;
    for (index, &(_, size)) in specs.iter().enumerate() {
        let target = driver
            .register_target(TargetConfig::new(index, size, Viewport::new(0, 0, size[0], size[1]), PixelFormat::Rgba8888))
            .map_err(|e| io::Error::other(format!("GLES target: {e:?}")))?;
        shared.borrow_mut().panels[index].target = target;
    }
    eprintln!("omarchy-pocket: display: EGL {major}.{minor}, GLES 2 renderer on {} displays", specs.len());
    let driver = Rc::new(RefCell::new(driver));
    let displays = (0..specs.len()).map(|index| Display { driver: driver.clone(), shared: shared.clone(), index, sequence: 0 }).collect();
    let shell = driver.clone();
    let compositor = Compositor::new(
        Box::new(move |handle, texture| shell.borrow_mut().set_external_texture(handle, texture)),
        display,
        context,
        pbuffer,
        shared.clone(),
    );
    Ok((Renderer { driver, _shared: shared.clone() }, displays, compositor, Windows { shared }))
}
