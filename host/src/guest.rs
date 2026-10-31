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
//! cross the JSON bridge or the JS heap. A loaded atlas changes no draw list,
//! so it asks for the next frame to be presented (`Repaint`).
//!
//! `omarchyBridge.powerProfile(name)` hands the host the power profile the
//! daemon reports (performance, balanced, power-saver); the clock floors
//! apply it at the next tick.
//!
//! `omarchyBridge.openApp(path)` opens a PocketJS package in a window: it runs
//! beside the shell in a Runtime of its own (children.rs) and draws into
//! textures the shell's windows show; `closeApp`, `showApp` and `appInput`
//! drive it. Its events arrive with the daemon's lines. A daemon line that
//! answers an app's HTTP request (`@net ...`, net.rs) goes to that app.
use crate::bridge::Bridge;
use crate::{children, net};
use pocket_guest_rquickjs::RquickjsGuest;
use pocket_runtime::{Guest, GuestEnvironment, GuestFrame, OpArg, OpContext, OpResult, RuntimeError};
use pocket_spec::op;
use rquickjs::{function::Opt, Function, Object};
use std::{
    cell::{Cell, RefCell},
    path::PathBuf,
    rc::Rc,
};

/// Set when the next frame must be presented though its draw lists are unchanged.
pub type Repaint = Rc<Cell<bool>>;
/// Set when lines arrived from the daemon this tick: something is going on
/// (terminal output, an applet's request answered, a bake in progress).
pub type Traffic = Rc<Cell<bool>>;

/// Omarchy Pocket's power profile, as the daemon reports it; the clock floors
/// apply it (floor.rs).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PowerProfile {
    Performance,
    Balanced,
    PowerSaver,
}

impl PowerProfile {
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "performance" => Some(Self::Performance),
            "balanced" => Some(Self::Balanced),
            "power-saver" => Some(Self::PowerSaver),
            _ => None,
        }
    }
}

/// Set by `omarchyBridge.powerProfile(name)`, taken by the main loop.
pub type ProfileRequest = Rc<Cell<Option<PowerProfile>>>;

pub struct BridgedGuest {
    inner: RquickjsGuest,
    bridge: Rc<RefCell<Bridge>>,
    ops: Option<OpContext>,
    repaint: Repaint,
    traffic: Traffic,
    profile: ProfileRequest,
    children: children::Shared,
    net: net::Shared,
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
    pub fn new(bridge: Rc<RefCell<Bridge>>, repaint: Repaint, traffic: Traffic, profile: ProfileRequest, children: children::Shared, net: net::Shared) -> Self {
        Self { inner: RquickjsGuest::default(), bridge, ops: None, repaint, traffic, profile, children, net }
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
            let repaint = self.repaint.clone();
            object.set(
                "loadFontAtlas",
                Function::new(ctx.clone(), move |path: String| {
                    let ok = load_font_atlas(&ops, &path);
                    repaint.set(repaint.get() || ok);
                    ok
                })?,
            )?;
            let profile = self.profile.clone();
            object.set(
                "powerProfile",
                Function::new(ctx.clone(), move |name: String| -> bool {
                    match PowerProfile::parse(&name) {
                        Some(p) => {
                            profile.set(Some(p));
                            true
                        }
                        None => false,
                    }
                })?,
            )?;
            let apps = self.children.clone();
            object.set(
                "openApp",
                // w, h: the touch surface's logical size, the tile's
                Function::new(ctx.clone(), move |path: String, w: Opt<u32>, h: Opt<u32>| -> i64 {
                    let path = PathBuf::from(path);
                    if path.extension().is_some_and(|e| e == "pocket") && path.is_file() {
                        apps.borrow_mut().open(path, w.0.zip(h.0).map(|(w, h)| [w, h])) as i64
                    } else {
                        -1
                    }
                })?,
            )?;
            let apps = self.children.clone();
            object.set("resizeApp", Function::new(ctx.clone(), move |id: u32, w: u32, h: u32| apps.borrow_mut().resize(id, [w, h]))?)?;
            let apps = self.children.clone();
            object.set("closeApp", Function::new(ctx.clone(), move |id: u32| apps.borrow_mut().close(id))?)?;
            let apps = self.children.clone();
            object.set("showApp", Function::new(ctx.clone(), move |id: u32, visible: bool| apps.borrow_mut().show(id, visible))?)?;
            let apps = self.children.clone();
            object.set(
                "appInput",
                // contacts: flat [id, x, y, ...] on the app's touch surface
                Function::new(ctx.clone(), move |id: u32, buttons: u32, contacts: Vec<f64>| {
                    let contacts = contacts.chunks_exact(3).map(|c| (c[0] as u32, c[1] as f32, c[2] as f32)).collect();
                    apps.borrow_mut().input(id, buttons, contacts);
                })?,
            )?;
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

impl BridgedGuest {
    /// A guest failure with the exception behind it, which the runtime's
    /// error does not carry.
    fn report<T>(&self, what: &str, result: Result<T, RuntimeError>) -> Result<T, RuntimeError> {
        if result.is_err() {
            eprintln!("omarchy-pocket-host: shell {what}: {}", self.inner.last_error().unwrap_or("no error text"));
        }
        result
    }
}

impl Guest for BridgedGuest {
    fn initialize(&mut self, ops: OpContext, environment: &GuestEnvironment<'_>) -> Result<(), RuntimeError> {
        self.ops = Some(ops.clone());
        let initialized = self.inner.initialize(ops, environment);
        self.report("initialize", initialized)?;
        self.install()
    }
    fn evaluate(&mut self, code: &[u8]) -> Result<(), RuntimeError> {
        let evaluated = self.inner.evaluate(code);
        self.report("boot", evaluated)
    }
    fn frame(&mut self, frame: &GuestFrame<'_>) -> Result<(), RuntimeError> {
        let (mut lines, dropped) = {
            let mut bridge = self.bridge.borrow_mut();
            let lines = bridge.poll();
            (lines, bridge.take_dropped())
        };
        if !lines.is_empty() {
            self.traffic.set(true);
        }
        {
            let mut net = self.net.borrow_mut();
            if dropped {
                net.fail_open();
            }
            lines.retain(|line| !net.reply(line));
        }
        lines.extend(self.children.borrow_mut().take_events());
        if !lines.is_empty() {
            self.deliver(lines);
        }
        let advanced = self.inner.frame(frame);
        self.report("frame", advanced)
    }
    fn collect(&mut self) -> Result<(), RuntimeError> {
        self.inner.collect()
    }
    fn shutdown(&mut self) {
        self.inner.shutdown();
    }
}
