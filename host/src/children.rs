//! Pocket apps in the shell's windows. A PocketJS package the shell opens
//! (`omarchyBridge.openApp(path)`) runs in a Runtime and realm of its own
//! beside the shell's, on the same profile, and draws its displays into
//! textures on the GPU (gpu::Compositor); the shell's window shows them by
//! a core texture handle bound to each. The shell decides everything else:
//! which window an app has, whether it is on the current workspace
//! (`showApp`, an app off screen is not advanced), and what input it gets
//! (`appInput`: the buttons the window manager does not take, and contacts
//! on the app's touch surface, which the deck shows).
//!
//! Requests from the shell's realm are queued and carried out after the
//! shell's guest turn, so an app never boots inside the shell's script. The
//! outcome reaches the shell as a bridge line:
//! `{"event":"app","id":1,"textures":[12,13]}` or `{"event":"app","id":1,"error":"..."}`,
//! and `{"event":"appExit","id":1,"error":"..."}` when a running app fails.
//!
//! An app's realm has `globalThis.net` (net.rs): HTTP and the companion's
//! services, which omarchy-pocketd performs.
use crate::net;
use pocket_drivers::{Contact, InputClasses, InputFrameBuilder, InputSource};
use pocket_guest_rquickjs::RquickjsGuest;
use pocket_linux_hooks::FileSource;
use pocket_runtime::{Guest, GuestEnvironment, GuestFrame, OpArg, OpContext, OpResult, Profile, Runtime, RuntimeConfig, RuntimeError};
use pocket_spec::op;
use std::{cell::RefCell, error::Error, path::PathBuf, rc::Rc};

/// What the shell feeds an app each frame.
#[derive(Default)]
struct Feed {
    buttons: u32,
    /// contacts on the app's auxiliary surface: (id, x, y) in its logical points
    contacts: Vec<(u32, f32, f32)>,
}

/// The input source an app's Runtime polls: whatever the shell fed it.
struct FedInput(Rc<RefCell<Feed>>);

impl InputSource for FedInput {
    fn classes(&self) -> InputClasses {
        InputClasses::BUTTONS | InputClasses::CONTACT
    }
    fn poll(&mut self, frame: &mut InputFrameBuilder) {
        let feed = self.0.borrow();
        frame.buttons |= feed.buttons;
        for &(id, x, y) in &feed.contacts {
            frame.contacts.push(Contact { surface: 1, id, x, y, cancelled: false });
        }
    }
}

struct App {
    id: u32,
    runtime: Runtime,
    feed: Rc<RefCell<Feed>>,
    /// the shell's core textures bound to the app's displays, in role order
    handles: Vec<i32>,
    visible: bool,
    /// the draw lists last rendered, to render only what changed
    primary: Vec<u32>,
    auxiliary: Vec<u32>,
}

enum Request {
    Open(u32, PathBuf),
    Close(u32),
}

/// An app's realm: the canonical rquickjs guest with `globalThis.net` in it.
struct AppGuest {
    inner: RquickjsGuest,
    net: net::Shared,
    app: u32,
}

impl Guest for AppGuest {
    fn initialize(&mut self, ops: OpContext, environment: &GuestEnvironment<'_>) -> Result<(), RuntimeError> {
        self.inner.initialize(ops, environment)?;
        match self.inner.with(|ctx| net::install(&ctx, &self.net, self.app)) {
            Some(Ok(())) => Ok(()),
            Some(Err(error)) => {
                eprintln!("omarchy-pocket-host: installing net in app {}: {error}", self.app);
                Err(RuntimeError::Guest)
            }
            None => Err(RuntimeError::Guest),
        }
    }
    fn evaluate(&mut self, code: &[u8]) -> Result<(), RuntimeError> {
        self.inner.evaluate(code)
    }
    fn frame(&mut self, frame: &GuestFrame<'_>) -> Result<(), RuntimeError> {
        self.inner.frame(frame)
    }
    fn collect(&mut self) -> Result<(), RuntimeError> {
        self.inner.collect()
    }
    fn shutdown(&mut self) {
        self.inner.shutdown();
    }
}

pub struct Children {
    next: u32,
    apps: Vec<App>,
    requests: Vec<Request>,
    events: Vec<String>,
    net: net::Shared,
}

pub type Shared = Rc<RefCell<Children>>;

const APP_HEAP: usize = 32 * 1024 * 1024;
/// a 4 x 4 placeholder: the shell's texture handle for an app's display; its
/// pixels never draw, the bound GL texture does
const PLACEHOLDER: [u8; 64] = [0; 64];

impl Children {
    pub fn new(net: net::Shared) -> Shared {
        Rc::new(RefCell::new(Self { next: 0, apps: Vec::new(), requests: Vec::new(), events: Vec::new(), net }))
    }

    /// Queues an app to open; its id now, its textures with the `app` event.
    pub fn open(&mut self, path: PathBuf) -> u32 {
        self.next += 1;
        let id = self.next;
        self.requests.push(Request::Open(id, path));
        id
    }

    pub fn close(&mut self, id: u32) {
        self.requests.push(Request::Close(id));
    }

    pub fn show(&mut self, id: u32, visible: bool) {
        if let Some(app) = self.apps.iter_mut().find(|a| a.id == id) {
            app.visible = visible;
        }
    }

    pub fn input(&mut self, id: u32, buttons: u32, contacts: Vec<(u32, f32, f32)>) {
        if let Some(app) = self.apps.iter().find(|a| a.id == id) {
            let mut feed = app.feed.borrow_mut();
            feed.buttons = buttons;
            feed.contacts = contacts;
        }
    }

    /// Bridge lines for the shell's next guest turn.
    pub fn take_events(&mut self) -> Vec<String> {
        std::mem::take(&mut self.events)
    }

    fn event(&mut self, id: u32, field: &str, value: String) {
        self.events.push(format!("{{\"event\":\"app\",\"id\":{id},\"{field}\":{value}}}"));
    }

    /// After the shell's guest turn: opens and closes what was asked for and
    /// runs one frame of every app on the current workspace. True when an app
    /// rendered, so the shell's panels show its new frame.
    #[cfg(target_os = "linux")]
    pub fn tick(&mut self, shell: &mut Runtime, profile: &Profile, compositor: &crate::gpu::Compositor) -> bool {
        for request in std::mem::take(&mut self.requests) {
            match request {
                Request::Open(id, path) => match self.boot(id, &path, shell, profile, compositor) {
                    Ok(handles) => {
                        let list = handles.iter().map(|h| h.to_string()).collect::<Vec<_>>().join(",");
                        self.event(id, "textures", format!("[{list}]"));
                    }
                    Err(failure) => {
                        eprintln!("omarchy-pocket-host: app {}: {failure}", path.display());
                        self.event(id, "error", net::json_string(&failure.to_string()));
                    }
                },
                Request::Close(id) => self.end(id, shell, compositor),
            }
        }
        let mut rendered = false;
        let mut failed = Vec::new();
        for app in self.apps.iter_mut().filter(|a| a.visible) {
            match frame(app) {
                Ok(drew) => rendered |= drew,
                Err(failure) => failed.push((app.id, failure.to_string())),
            }
        }
        for (id, failure) in failed {
            eprintln!("omarchy-pocket-host: app {id} stopped: {failure}");
            self.end(id, shell, compositor);
            self.events.push(format!("{{\"event\":\"appExit\",\"id\":{id},\"error\":{}}}", net::json_string(&failure)));
        }
        rendered
    }

    #[cfg(target_os = "linux")]
    fn boot(&mut self, id: u32, path: &PathBuf, shell: &mut Runtime, profile: &Profile, compositor: &crate::gpu::Compositor) -> Result<Vec<i32>, Box<dyn Error>> {
        use pocket_drivers::DisplayRole;
        let error = |e: pocket_runtime::RuntimeError| format!("{e:?}");
        let top = [profile.viewport[0], profile.viewport[1]];
        let bottom = profile.auxiliary.ok_or("the profile has no auxiliary display")?;
        let gpu = compositor.app(&[(DisplayRole::Primary, top), (DisplayRole::Auxiliary, bottom)])?;
        let mut runtime = Runtime::new(RuntimeConfig {
            profile_hash: crate::profile::PROFILE_HASH,
            host_abi: crate::profile::HOST_ABI,
            heap_limit: APP_HEAP,
            frame_buffer_budget: (top[0] * top[1] + bottom[0] * bottom[1]) as usize * 8,
            profile: profile.clone(),
        })
        .map_err(error)?;
        runtime.set_package_source(Box::new(FileSource::open(path)?)).map_err(error)?;
        let renderer = runtime.add_renderer(gpu.renderer).map_err(error)?;
        for display in gpu.displays {
            runtime.add_display(display, renderer).map_err(error)?;
        }
        let feed = Rc::new(RefCell::new(Feed::default()));
        runtime.add_input_source(Box::new(FedInput(feed.clone()))).map_err(error)?;
        self.net.borrow_mut().add_app(id, path.display().to_string());
        let guest = AppGuest { inner: RquickjsGuest::default(), net: self.net.clone(), app: id };
        runtime.set_guest(Box::new(guest)).map_err(error)?;
        if let Err(failure) = runtime.boot() {
            self.net.borrow_mut().remove_app(id);
            return Err(error(failure).into());
        }
        // the shell's core textures that stand for the app's displays
        let ops = shell.op_context();
        let mut handles = Vec::new();
        for texture in &gpu.textures {
            let args = [OpArg::Bytes(&PLACEHOLDER), OpArg::Integer(4), OpArg::Integer(4), OpArg::Integer(3)];
            let handle = match ops.dispatch(op::UPLOAD_TEXTURE as u16, &args) {
                Ok(OpResult::Integer(h)) if h >= 0 => h as i32,
                _ => return Err("the shell has no texture for the app".into()),
            };
            compositor.bind(handle, Some(*texture));
            handles.push(handle);
        }
        self.apps.push(App { id, runtime, feed, handles: handles.clone(), visible: true, primary: Vec::new(), auxiliary: Vec::new() });
        Ok(handles)
    }

    #[cfg(target_os = "linux")]
    fn end(&mut self, id: u32, shell: &mut Runtime, compositor: &crate::gpu::Compositor) {
        let Some(at) = self.apps.iter().position(|a| a.id == id) else { return };
        let mut app = self.apps.remove(at);
        let ops = shell.op_context();
        for handle in &app.handles {
            // the shell stops drawing the GL texture before it goes with the app
            compositor.bind(*handle, None);
            let _ = ops.dispatch(op::FREE_TEXTURE as u16, &[OpArg::Integer(*handle as i64)]);
        }
        let _ = app.runtime.shutdown();
        self.net.borrow_mut().remove_app(id);
    }
}

/// One frame of an app: its guest and core advance, and its displays render
/// when either draw list changed.
fn frame(app: &mut App) -> Result<bool, Box<dyn Error>> {
    let error = |e: pocket_runtime::RuntimeError| format!("{e:?}");
    app.runtime.advance().map_err(error)?;
    let changed = {
        let ops = app.runtime.op_context();
        let mut state = ops.core_mut().map_err(error)?;
        let primary = &state.ui.draw().words;
        let mut changed = *primary != app.primary;
        if changed {
            app.primary.clone_from(primary);
        }
        if let Some(auxiliary) = state.ui.draw_auxiliary() {
            if auxiliary.words != app.auxiliary {
                app.auxiliary.clone_from(&auxiliary.words);
                changed = true;
            }
        }
        changed
    };
    if changed {
        app.runtime.present().map_err(error)?;
    } else {
        app.runtime.skip_presentation().map_err(error)?;
    }
    Ok(changed)
}

