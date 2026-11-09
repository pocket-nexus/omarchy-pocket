//! The EGL and GLES entry points both GPU back ends call (gpu.rs on the RG DS
//! Plus, gpu_android.rs on the AYN Thor). On the RG DS Plus they all come
//! from libmali.so.1, whose libEGL/libGLESv2 wrappers export none of them; on
//! Android from the platform's libEGL and libGLESv2. pocket-gles declares the
//! other gl* entry points without a library.
#![allow(non_camel_case_types, dead_code)]
use std::ffi::{c_char, c_void};

pub type EGLDisplay = *mut c_void;
pub type EGLConfig = *mut c_void;
pub type EGLContext = *mut c_void;
pub type EGLSurface = *mut c_void;
pub type EGLint = i32;
pub type EGLBoolean = u32;

pub const EGL_NONE: EGLint = 0x3038;
pub const EGL_SURFACE_TYPE: EGLint = 0x3033;
pub const EGL_WINDOW_BIT: EGLint = 0x0004;
pub const EGL_PBUFFER_BIT: EGLint = 0x0001;
pub const EGL_RENDERABLE_TYPE: EGLint = 0x3040;
pub const EGL_OPENGL_ES2_BIT: EGLint = 0x0004;
pub const EGL_RED_SIZE: EGLint = 0x3024;
pub const EGL_GREEN_SIZE: EGLint = 0x3023;
pub const EGL_BLUE_SIZE: EGLint = 0x3022;
pub const EGL_ALPHA_SIZE: EGLint = 0x3021;
pub const EGL_WIDTH: EGLint = 0x3057;
pub const EGL_HEIGHT: EGLint = 0x3056;
pub const EGL_NATIVE_VISUAL_ID: EGLint = 0x302e;
pub const EGL_CONTEXT_CLIENT_VERSION: EGLint = 0x3098;
pub const EGL_OPENGL_ES_API: u32 = 0x30a0;
pub const EGL_BAD_SURFACE: EGLint = 0x300d;
pub const EGL_BAD_NATIVE_WINDOW: EGLint = 0x300b;

#[cfg_attr(target_os = "linux", link(name = "mali"))]
#[cfg_attr(target_os = "android", link(name = "EGL"))]
unsafe extern "C" {
    pub fn eglGetProcAddress(name: *const c_char) -> *mut c_void;
    pub fn eglGetDisplay(native: *mut c_void) -> EGLDisplay;
    pub fn eglInitialize(d: EGLDisplay, major: *mut EGLint, minor: *mut EGLint) -> EGLBoolean;
    pub fn eglBindAPI(api: u32) -> EGLBoolean;
    pub fn eglChooseConfig(d: EGLDisplay, attributes: *const EGLint, configs: *mut EGLConfig, size: EGLint, count: *mut EGLint) -> EGLBoolean;
    pub fn eglGetConfigAttrib(d: EGLDisplay, config: EGLConfig, attribute: EGLint, value: *mut EGLint) -> EGLBoolean;
    pub fn eglCreateContext(d: EGLDisplay, config: EGLConfig, share: EGLContext, attributes: *const EGLint) -> EGLContext;
    pub fn eglCreateWindowSurface(d: EGLDisplay, config: EGLConfig, window: *mut c_void, attributes: *const EGLint) -> EGLSurface;
    pub fn eglCreatePbufferSurface(d: EGLDisplay, config: EGLConfig, attributes: *const EGLint) -> EGLSurface;
    pub fn eglMakeCurrent(d: EGLDisplay, draw: EGLSurface, read: EGLSurface, context: EGLContext) -> EGLBoolean;
    pub fn eglGetCurrentContext() -> EGLContext;
    pub fn eglSwapBuffers(d: EGLDisplay, surface: EGLSurface) -> EGLBoolean;
    pub fn eglSwapInterval(d: EGLDisplay, interval: EGLint) -> EGLBoolean;
    pub fn eglDestroySurface(d: EGLDisplay, surface: EGLSurface) -> EGLBoolean;
    pub fn eglDestroyContext(d: EGLDisplay, context: EGLContext) -> EGLBoolean;
    pub fn eglTerminate(d: EGLDisplay) -> EGLBoolean;
    pub fn eglGetError() -> EGLint;
}

#[cfg_attr(target_os = "linux", link(name = "mali"))]
#[cfg_attr(target_os = "android", link(name = "GLESv2"))]
unsafe extern "C" {
    pub fn glReadPixels(x: i32, y: i32, width: i32, height: i32, format: u32, kind: u32, pixels: *mut c_void);
    // offscreen targets for the apps in the shell's windows (compositor.rs)
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

pub fn egl_error(what: &str) -> std::io::Error {
    std::io::Error::other(format!("{what}: EGL error {:#x}", unsafe { eglGetError() }))
}
