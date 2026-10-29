//! The shell's QuickJS realm with the Omarchy bridge in it. It wraps the
//! canonical rquickjs guest: after the realm boots it installs
//! `globalThis.omarchyBridge.send(line)`, which only queues the line, and at
//! the start of each guest turn it hands the lines the daemon sent to
//! `globalThis.__omarchyBridgeReceive(lines)`. The realm never waits on the
//! daemon, and every reply lands at a tick boundary.
//!
//! `omarchyBridge.loadTexture(path, w, h)` uploads a raw RGBA8888 file the
//! daemon wrote (a wallpaper tile) as a texture and returns its handle, or
//! -1; `omarchyBridge.loadFontAtlas(path)` loads a FONT ATLAS file the daemon
//! baked (run-time CJK glyphs) into its slot. Image and atlas bytes never
//! cross the JSON bridge or the JS heap.
use crate::bridge::Bridge;
use pocket_guest_rquickjs::RquickjsGuest;
use pocket_runtime::{Guest, GuestEnvironment, GuestFrame, OpArg, OpContext, OpResult, RuntimeError};
use pocket_spec::op;
use rquickjs::{Function, Object};
use std::{cell::RefCell, rc::Rc};

pub struct BridgedGuest {
    inner: RquickjsGuest,
    bridge: Rc<RefCell<Bridge>>,
    ops: Option<OpContext>,
}

/// PSM_8888, the RGBA texture format of spec ops
const PSM_8888: i64 = 3;
const TEXTURE_MAX: usize = 512;

/// Reads a FONT ATLAS file and loads it into the slot its header names.
fn load_font_atlas(ops: &OpContext, path: &str) -> bool {
    let Ok(bytes) = std::fs::read(path) else { return false };
    match ops.dispatch(op::LOAD_FONT_ATLAS as u16, &[OpArg::Bytes(&bytes)]) {
        Ok(OpResult::Integer(ok)) => ok != 0,
        Ok(_) => true,
        Err(error) => {
            eprintln!("omarchy-pocket-host: loading {path}: {error:?}");
            false
        }
    }
}

/// Reads `path` (w*h RGBA8888) and uploads it; -1 when the file or the size is wrong.
fn load_texture(ops: &OpContext, path: &str, w: usize, h: usize) -> i64 {
    if !(w.is_power_of_two() && h.is_power_of_two() && w <= TEXTURE_MAX && h <= TEXTURE_MAX) {
        return -1;
    }
    let Ok(bytes) = std::fs::read(path) else { return -1 };
    if bytes.len() != w * h * 4 {
        return -1;
    }
    let args = [OpArg::Bytes(&bytes), OpArg::Integer(w as i64), OpArg::Integer(h as i64), OpArg::Integer(PSM_8888)];
    match ops.dispatch(op::UPLOAD_TEXTURE as u16, &args) {
        Ok(OpResult::Integer(handle)) => handle,
        Ok(_) => -1,
        Err(error) => {
            eprintln!("omarchy-pocket-host: uploading {path}: {error:?}");
            -1
        }
    }
}

impl BridgedGuest {
    pub fn new(bridge: Bridge) -> Self {
        Self {
            inner: RquickjsGuest::default(),
            bridge: Rc::new(RefCell::new(bridge)),
            ops: None,
        }
    }

    fn install(&self) -> Result<(), RuntimeError> {
        let bridge = self.bridge.clone();
        let ops = self.ops.clone().ok_or(RuntimeError::Guest)?;
        let installed = self.inner.with(|ctx| -> rquickjs::Result<()> {
            let object = Object::new(ctx.clone())?;
            object.set(
                "send",
                Function::new(ctx.clone(), move |line: String| {
                    bridge.borrow_mut().send(&line);
                })?,
            )?;
            let texture_ops = ops.clone();
            object.set(
                "loadTexture",
                Function::new(ctx.clone(), move |path: String, w: u32, h: u32| load_texture(&texture_ops, &path, w as usize, h as usize))?,
            )?;
            object.set("loadFontAtlas", Function::new(ctx.clone(), move |path: String| load_font_atlas(&ops, &path))?)?;
            ctx.globals().set("omarchyBridge", object)
        });
        match installed {
            Some(Ok(())) => Ok(()),
            Some(Err(error)) => {
                eprintln!("omarchy-pocket-host: installing the bridge: {error}");
                Err(RuntimeError::Guest)
            }
            None => Err(RuntimeError::Guest),
        }
    }

    fn deliver(&self, lines: Vec<String>) {
        let delivered = self.inner.with(|ctx| -> rquickjs::Result<()> {
            let receive: Option<Function> = ctx.globals().get("__omarchyBridgeReceive")?;
            match receive {
                Some(receive) => receive.call::<_, ()>((lines,)),
                None => Ok(()),
            }
        });
        if let Some(Err(error)) = delivered {
            // a throwing handler loses its batch, not the realm
            eprintln!("omarchy-pocket-host: bridge delivery: {error}");
        }
    }
}

impl Guest for BridgedGuest {
    fn initialize(&mut self, ops: OpContext, environment: &GuestEnvironment<'_>) -> Result<(), RuntimeError> {
        self.ops = Some(ops.clone());
        self.inner.initialize(ops, environment)?;
        self.install()
    }
    fn evaluate(&mut self, code: &[u8]) -> Result<(), RuntimeError> {
        self.inner.evaluate(code)
    }
    fn frame(&mut self, frame: &GuestFrame<'_>) -> Result<(), RuntimeError> {
        let lines = self.bridge.borrow_mut().poll();
        if !lines.is_empty() {
            self.deliver(lines);
        }
        self.inner.frame(frame)
    }
    fn collect(&mut self) -> Result<(), RuntimeError> {
        self.inner.collect()
    }
    fn shutdown(&mut self) {
        self.inner.shutdown();
    }
}
