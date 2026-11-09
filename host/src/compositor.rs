//! The pocket apps in the shell's windows, on the GPU. Each app renders its
//! displays into its own textures (a framebuffer each) with its own GLES
//! renderer on the shell's EGL context; the shell's renderer draws a texture
//! wherever the shell draws the core texture bound to it (`bind`), in the
//! shell's paint order, with no copy. Both GPU back ends (gpu.rs on KMS,
//! gpu_android.rs on Android windows) build one from their context.
use crate::egl::*;
use pocket_drivers::*;
use pocket_gles::{ContextAccess, TargetConfig, Viewport};
use std::{
    any::Any,
    cell::{Cell, RefCell},
    io, ptr,
    rc::Rc,
};

pub struct Compositor {
    /// `set_external_texture` on the shell's renderer
    bind: Box<dyn Fn(i32, Option<u32>)>,
    display: EGLDisplay,
    context: EGLContext,
    /// a surface that stays valid, to make the context current between panel draws
    surface: EGLSurface,
    /// what owns the context and surfaces, kept as long as the compositor
    _keep: Rc<dyn Any>,
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
    /// `bind` hands a GL texture to the shell's renderer for a core texture
    /// handle; `surface` stays valid while the compositor lives; `keep` owns
    /// the context and surfaces.
    pub fn new(bind: Box<dyn Fn(i32, Option<u32>)>, display: EGLDisplay, context: EGLContext, surface: EGLSurface, keep: Rc<dyn Any>) -> Self {
        Self { bind, display, context, surface, _keep: keep }
    }

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
        (self.bind)(handle, texture);
    }
}
