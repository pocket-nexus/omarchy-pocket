//! HTTP for the apps in the shell's windows. An app's network is its worker
//! domain (pocket-linux-worker): the worker's `http` node hands each request to
//! [`DaemonExchange`], whose calls wait in an outbox until the shell's thread
//! carries them to omarchy-pocketd as bridge lines, and the daemon performs
//! them: the companion's services (`https://companion.pocket/<name>/...`, the
//! X, Discord, YouTube and glyphs providers) on this device, any other URL
//! fetched, within what the app's package may reach.
//!
//!   host -> daemon  {"method":"appNet","h":7,"package":"/usr/share/.../x.pocket","meta":"{...}","body":"<base64>"}
//!                   {"method":"appNetCancel","h":7}
//!   daemon -> host  @net 7 <base64 body | -> {"t":"done","h":7,"status":200,...,"bytes":N}
//!
//! A reply line starts with `@net ` and never reaches the shell's realm; it
//! answers the call, and the node turns the answer into the worker's facts.
//! Handles are unique across apps, so a reply finds its call by handle alone.
use crate::bridge::Bridge;
use pocket_linux_worker::{Call, Exchange, Failure, Response};
use std::{
    cell::RefCell,
    collections::{BTreeMap, HashMap},
    rc::Rc,
    sync::{Arc, Mutex},
};

/// Requests one app may have at the daemon at once; the rest wait in the outbox.
const OPEN_LIMIT: usize = 8;

/// Calls from the apps' workers, for the shell's thread.
type Outbox = Arc<Mutex<Vec<(u32, Call)>>>;

/// An app's exchange: its calls go to the outbox, tagged with the app.
pub struct DaemonExchange {
    app: u32,
    outbox: Outbox,
}

impl Exchange for DaemonExchange {
    fn start(&self, call: Call) {
        self.outbox.lock().unwrap().push((self.app, call));
    }
}

struct Open {
    app: u32,
    call: Call,
}

pub struct Hub {
    bridge: Rc<RefCell<Bridge>>,
    next: u32,
    /// app id -> its package's path, which the daemon reads its rights from
    apps: HashMap<u32, String>,
    outbox: Outbox,
    /// calls at the daemon, by handle
    open: HashMap<u32, Open>,
}

pub type Shared = Rc<RefCell<Hub>>;

impl Hub {
    pub fn new(bridge: Rc<RefCell<Bridge>>) -> Shared {
        Rc::new(RefCell::new(Self { bridge, next: 0, apps: HashMap::new(), outbox: Arc::default(), open: HashMap::new() }))
    }

    /// The exchange for app `app`'s worker.
    pub fn add_app(&mut self, app: u32, package: String) -> DaemonExchange {
        self.apps.insert(app, package);
        DaemonExchange { app, outbox: self.outbox.clone() }
    }

    /// The app ended: its calls are dropped and cancelled at the daemon.
    pub fn remove_app(&mut self, app: u32) {
        self.apps.remove(&app);
        self.outbox.lock().unwrap().retain(|(owner, _)| *owner != app);
        let handles: Vec<u32> = self.open.iter().filter(|(_, open)| open.app == app).map(|(h, _)| *h).collect();
        for handle in handles {
            self.open.remove(&handle);
            self.cancel(handle);
        }
    }

    fn cancel(&self, handle: u32) {
        self.bridge.borrow_mut().send(&format!("{{\"method\":\"appNetCancel\",\"h\":{handle}}}"));
    }

    /// On the shell's thread, once a tick: calls the workers cancelled are
    /// cancelled at the daemon, and waiting calls go to it while their app has
    /// fewer than OPEN_LIMIT there.
    pub fn pump(&mut self) {
        let abandoned: Vec<u32> = self.open.iter().filter(|(_, open)| open.call.abandoned()).map(|(h, _)| *h).collect();
        for handle in abandoned {
            self.open.remove(&handle);
            self.cancel(handle);
        }
        let waiting = std::mem::take(&mut *self.outbox.lock().unwrap());
        let mut held = Vec::new();
        for (app, call) in waiting {
            if call.abandoned() {
                continue;
            }
            let Some(package) = self.apps.get(&app) else { continue };
            if self.open.values().filter(|open| open.app == app).count() >= OPEN_LIMIT {
                held.push((app, call));
                continue;
            }
            self.next += 1;
            let handle = self.next;
            let request = call.request();
            let mut meta = format!("{{\"url\":{},\"method\":{},\"headers\":{{", json_string(&request.url), json_string(&request.method));
            for (at, (name, value)) in request.headers.iter().enumerate() {
                if at > 0 {
                    meta.push(',');
                }
                meta.push_str(&format!("{}:{}", json_string(name), json_string(value)));
            }
            meta.push_str(&format!("}},\"timeoutMs\":{},\"maxBytes\":{}}}", request.timeout.as_millis(), request.max_bytes));
            let line = format!(
                "{{\"method\":\"appNet\",\"h\":{handle},\"package\":{},\"meta\":{},\"body\":\"{}\"}}",
                json_string(package),
                json_string(&meta),
                base64_encode(&request.body)
            );
            self.bridge.borrow_mut().send(&line);
            self.open.insert(handle, Open { app, call });
        }
        if !held.is_empty() {
            let mut outbox = self.outbox.lock().unwrap();
            held.append(&mut outbox);
            *outbox = held;
        }
    }

    /// The daemon went away: every call at it fails.
    pub fn fail_open(&mut self) {
        for (_, open) in self.open.drain() {
            open.call.answer(Err(Failure { reached: true, message: "omarchy-pocketd restarted".into() }));
        }
    }

    /// A daemon line that is a reply to an app's request; false for any other.
    pub fn reply(&mut self, line: &str) -> bool {
        let Some(rest) = line.strip_prefix("@net ") else { return false };
        let mut parts = rest.splitn(3, ' ');
        let (Some(handle), Some(body), Some(event)) = (parts.next(), parts.next(), parts.next()) else { return true };
        let Ok(handle) = handle.parse::<u32>() else { return true };
        // a cancelled request's reply finds no call and is dropped
        let Some(open) = self.open.remove(&handle) else { return true };
        open.call.answer(answer(body, event));
        true
    }
}

/// A reply's body and event as the worker's answer.
fn answer(body: &str, event: &str) -> Result<Response, Failure> {
    let failed = |message: String| Err(Failure { reached: true, message });
    let Ok(event) = serde_json::from_str::<serde_json::Value>(event) else { return failed("the daemon's event is not JSON".into()) };
    if event["t"] != "done" {
        let code = event["code"].as_str().unwrap_or("other");
        let message = event["message"].as_str().unwrap_or("the request failed");
        // a request refused before it left the device never reached a server
        let reached = !matches!(code, "connect" | "invalid_request" | "busy" | "dns");
        return Err(Failure { reached, message: format!("{code}: {message}") });
    }
    let body = if body == "-" {
        Vec::new()
    } else {
        match base64_decode(body) {
            Some(bytes) => bytes,
            None => return failed("the daemon's body is not base64".into()),
        }
    };
    let mut headers = BTreeMap::new();
    if let Some(fields) = event["headers"].as_object() {
        for (name, value) in fields {
            if let Some(value) = value.as_str() {
                headers.insert(name.to_ascii_lowercase(), value.to_string());
            }
        }
    }
    let status = event["status"].as_u64().filter(|s| (100..=599).contains(s)).unwrap_or(502) as u16;
    Ok(Response { status, headers, body })
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
    fn a_reply_becomes_a_response_or_a_failure() {
        let done = answer("aGk=", r#"{"t":"done","h":1,"status":200,"headers":{"Content-Type":"text/plain"},"bytes":2}"#).unwrap();
        assert_eq!((done.status, done.body.as_slice()), (200, &b"hi"[..]));
        assert_eq!(done.headers.get("content-type").map(String::as_str), Some("text/plain"));
        let empty = answer("-", r#"{"t":"done","h":1,"status":204,"bytes":0}"#).unwrap();
        assert!(empty.body.is_empty());
        let refused = answer("-", r#"{"t":"error","h":1,"code":"connect","message":"no route"}"#).unwrap_err();
        assert!(!refused.reached);
        let timeout = answer("-", r#"{"t":"error","h":1,"code":"timeout","message":"late"}"#).unwrap_err();
        assert!(timeout.reached);
    }
}
