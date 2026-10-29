//! The shell's QuickJS realm with the Omarchy bridge in it. It wraps the
//! canonical rquickjs guest: after the realm boots it installs
//! `globalThis.omarchyBridge.send(line)`, which only queues the line, and at
//! the start of each guest turn it hands the lines the daemon sent to
//! `globalThis.__omarchyBridgeReceive(lines)`. The realm never waits on the
//! daemon, and every reply lands at a tick boundary.
use crate::bridge::Bridge;
use pocket_guest_rquickjs::RquickjsGuest;
use pocket_runtime::{Guest, GuestEnvironment, GuestFrame, OpContext, RuntimeError};
use rquickjs::{Function, Object};
use std::{cell::RefCell, rc::Rc};

pub struct BridgedGuest {
    inner: RquickjsGuest,
    bridge: Rc<RefCell<Bridge>>,
}

impl BridgedGuest {
    pub fn new(bridge: Bridge) -> Self {
        Self {
            inner: RquickjsGuest::default(),
            bridge: Rc::new(RefCell::new(bridge)),
        }
    }

    fn install(&self) -> Result<(), RuntimeError> {
        let bridge = self.bridge.clone();
        let installed = self.inner.with(|ctx| -> rquickjs::Result<()> {
            let object = Object::new(ctx.clone())?;
            object.set(
                "send",
                Function::new(ctx.clone(), move |line: String| {
                    bridge.borrow_mut().send(&line);
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

impl Guest for BridgedGuest {
    fn initialize(&mut self, ops: OpContext, environment: &GuestEnvironment<'_>) -> Result<(), RuntimeError> {
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
