//! HTTP for the apps in the shell's windows. Each app's realm gets
//! `globalThis.net`, the NET ops a PocketJS UI realm had before pocketjs moved
//! HTTP into worker domains (`start`, `take`, `cancel`, `poll`, `lastError`;
//! applets/lib/net.ts is the fetch() over them). The host carries a request
//! to omarchy-pocketd as a bridge line, and the daemon performs it: the
//! companion's services (`https://companion.pocket/<name>/...`, the X, Discord,
//! YouTube and glyphs providers) on this device, any other URL fetched.
//!
//!   host -> daemon  {"method":"appNet","h":7,"package":"/usr/share/.../x.pocket","meta":"{...}","body":"<base64>"}
//!                   {"method":"appNetCancel","h":7}
//!   daemon -> host  @net 7 <base64 body | -> {"t":"done","h":7,"status":200,...,"bytes":N}
//!
//! QuickJS has no TextDecoder or TextEncoder: `net.decode(buffer)` and
//! `net.encode(text)` are UTF-8 in Rust, for response.text() and string bodies.
//!
//! A reply line starts with `@net ` and never reaches the shell's realm. The
//! event is the JSON `poll()` hands the app, the body what `take()` copies.
//! Handles are unique across apps, so a reply finds its app by handle alone.
use crate::bridge::Bridge;
use rquickjs::{ArrayBuffer, Ctx, Function, Object};
use std::{
    cell::RefCell,
    collections::HashMap,
    rc::Rc,
};

/// Requests one app may have open at once; past it `start` refuses with `busy`.
const OPEN_LIMIT: usize = 8;
/// The largest request body (contracts/spec/net.ts NET_MAX_REQUEST_BYTES).
const REQUEST_MAX: usize = 64 * 1024;

#[derive(Default)]
struct AppNet {
    package: String,
    /// handles started and not yet settled
    open: Vec<u32>,
    /// event objects for the next poll
    events: Vec<String>,
    /// bodies of settled requests until take()
    bodies: HashMap<u32, Vec<u8>>,
    last_error: String,
}

pub struct Hub {
    bridge: Rc<RefCell<Bridge>>,
    next: u32,
    apps: HashMap<u32, AppNet>,
}

pub type Shared = Rc<RefCell<Hub>>;

impl Hub {
    pub fn new(bridge: Rc<RefCell<Bridge>>) -> Shared {
        Rc::new(RefCell::new(Self { bridge, next: 0, apps: HashMap::new() }))
    }

    pub fn add_app(&mut self, app: u32, package: String) {
        self.apps.insert(app, AppNet { package, ..Default::default() });
    }

    /// The app ended: its open requests are cancelled at the daemon.
    pub fn remove_app(&mut self, app: u32) {
        if let Some(net) = self.apps.remove(&app) {
            for handle in net.open {
                self.bridge.borrow_mut().send(&format!("{{\"method\":\"appNetCancel\",\"h\":{handle}}}"));
            }
        }
    }

    fn start(&mut self, app: u32, meta: &str, body: &[u8]) -> i64 {
        let Some(net) = self.apps.get_mut(&app) else { return -1 };
        if net.open.len() >= OPEN_LIMIT {
            net.last_error = format!("busy: {OPEN_LIMIT} requests are open");
            return -1;
        }
        if body.len() > REQUEST_MAX {
            net.last_error = "invalid_request: request body exceeds 64 KiB".into();
            return -1;
        }
        self.next += 1;
        let handle = self.next;
        net.open.push(handle);
        let line = format!(
            "{{\"method\":\"appNet\",\"h\":{handle},\"package\":{},\"meta\":{},\"body\":\"{}\"}}",
            json_string(&net.package),
            json_string(meta),
            base64_encode(body)
        );
        self.bridge.borrow_mut().send(&line);
        handle as i64
    }

    fn take(&mut self, app: u32, handle: u32, into: &mut [u8]) -> i64 {
        let Some(net) = self.apps.get_mut(&app) else { return -1 };
        match net.bodies.remove(&handle) {
            Some(body) if body.len() == into.len() => {
                into.copy_from_slice(&body);
                body.len() as i64
            }
            _ => -1,
        }
    }

    fn cancel(&mut self, app: u32, handle: u32) {
        let Some(net) = self.apps.get_mut(&app) else { return };
        net.bodies.remove(&handle);
        if let Some(at) = net.open.iter().position(|h| *h == handle) {
            net.open.remove(at);
            self.bridge.borrow_mut().send(&format!("{{\"method\":\"appNetCancel\",\"h\":{handle}}}"));
        }
    }

    fn poll(&mut self, app: u32) -> Option<String> {
        let net = self.apps.get_mut(&app)?;
        if net.events.is_empty() {
            return None;
        }
        Some(format!("[{}]", std::mem::take(&mut net.events).join(",")))
    }

    /// The daemon went away: every open request fails with `connect`.
    pub fn fail_open(&mut self) {
        for net in self.apps.values_mut() {
            for handle in std::mem::take(&mut net.open) {
                net.events.push(format!("{{\"t\":\"error\",\"h\":{handle},\"code\":\"connect\",\"message\":\"omarchy-pocketd restarted\"}}"));
            }
        }
    }

    /// A daemon line that is a reply to an app's request; false for any other.
    pub fn reply(&mut self, line: &str) -> bool {
        let Some(rest) = line.strip_prefix("@net ") else { return false };
        let mut parts = rest.splitn(3, ' ');
        let (Some(handle), Some(body), Some(event)) = (parts.next(), parts.next(), parts.next()) else { return true };
        let Ok(handle) = handle.parse::<u32>() else { return true };
        // a cancelled request's reply finds no open handle and is dropped
        let Some(net) = self.apps.values_mut().find(|n| n.open.contains(&handle)) else { return true };
        net.open.retain(|h| *h != handle);
        if body != "-" {
            match base64_decode(body) {
                Some(bytes) => {
                    net.bodies.insert(handle, bytes);
                }
                None => {
                    net.events.push(format!("{{\"t\":\"error\",\"h\":{handle},\"code\":\"protocol\",\"message\":\"the daemon's body is not base64\"}}"));
                    return true;
                }
            }
        }
        net.events.push(event.to_string());
        true
    }
}

/// Installs `globalThis.net` in an app's realm.
pub fn install<'js>(ctx: &Ctx<'js>, hub: &Shared, app: u32) -> rquickjs::Result<()> {
    let object = Object::new(ctx.clone())?;
    let h = hub.clone();
    object.set(
        "start",
        Function::new(ctx.clone(), move |meta: String, body: ArrayBuffer<'js>| -> i64 {
            let bytes = body.as_bytes().unwrap_or(&[]);
            h.borrow_mut().start(app, &meta, bytes)
        })?,
    )?;
    let h = hub.clone();
    object.set(
        "take",
        Function::new(ctx.clone(), move |handle: u32, into: ArrayBuffer<'js>| -> i64 {
            let Some(raw) = into.as_raw() else { return -1 };
            // SAFETY: the buffer is alive for this call and nothing else holds its bytes
            let bytes = unsafe { std::slice::from_raw_parts_mut(raw.ptr.as_ptr(), raw.len) };
            h.borrow_mut().take(app, handle, bytes)
        })?,
    )?;
    let h = hub.clone();
    object.set("cancel", Function::new(ctx.clone(), move |handle: u32| h.borrow_mut().cancel(app, handle))?)?;
    let h = hub.clone();
    object.set("poll", Function::new(ctx.clone(), move || h.borrow_mut().poll(app))?)?;
    let h = hub.clone();
    object.set(
        "lastError",
        Function::new(ctx.clone(), move || h.borrow().apps.get(&app).map(|n| n.last_error.clone()).unwrap_or_default())?,
    )?;
    object.set(
        "decode",
        Function::new(ctx.clone(), |buffer: ArrayBuffer<'js>| String::from_utf8_lossy(buffer.as_bytes().unwrap_or(&[])).into_owned())?,
    )?;
    let encoder = ctx.clone();
    object.set(
        "encode",
        Function::new(ctx.clone(), move |text: String| ArrayBuffer::new_copy(encoder.clone(), text.as_bytes()))?,
    )?;
    ctx.globals().set("net", object)
}

/// A JSON string literal.
pub fn json_string(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(ALPHABET[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

fn base64_decode(text: &str) -> Option<Vec<u8>> {
    let text = text.trim_end_matches('=').as_bytes();
    let mut out = Vec::with_capacity(text.len() * 3 / 4);
    let (mut acc, mut bits) = (0u32, 0u32);
    for &c in text {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        } as u32;
        acc = acc << 6 | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_round_trips_every_length() {
        for len in 0..40 {
            let bytes: Vec<u8> = (0..len).map(|i| (i * 37 + 11) as u8).collect();
            assert_eq!(base64_decode(&base64_encode(&bytes)).unwrap(), bytes);
        }
        assert_eq!(base64_encode(b"Man"), "TWFu");
        assert_eq!(base64_encode(b"Ma"), "TWE=");
        assert_eq!(base64_decode("TQ==").unwrap(), b"M");
        assert!(base64_decode("T!").is_none());
    }

    #[test]
    fn a_reply_settles_its_request_and_a_cancelled_one_is_dropped() {
        let hub = Hub::new(Rc::new(RefCell::new(Bridge::new(None))));
        let mut hub = hub.borrow_mut();
        hub.add_app(1, "/x.pocket".into());
        let a = hub.start(1, "{}", b"") as u32;
        let b = hub.start(1, "{}", b"") as u32;
        hub.cancel(1, b);
        assert!(hub.reply(&format!("@net {a} aGk= {{\"t\":\"done\",\"h\":{a},\"bytes\":2}}")));
        assert!(hub.reply(&format!("@net {b} - {{\"t\":\"error\",\"h\":{b}}}")));
        assert!(!hub.reply("{\"event\":\"state\"}"));
        assert_eq!(hub.poll(1).unwrap(), format!("[{{\"t\":\"done\",\"h\":{a},\"bytes\":2}}]"));
        assert!(hub.poll(1).is_none());
        let mut into = [0u8; 2];
        assert_eq!(hub.take(1, a, &mut into), 2);
        assert_eq!(&into, b"hi");
        assert_eq!(hub.take(1, a, &mut into), -1);
    }
}
