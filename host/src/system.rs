//! PocketJS's system capabilities for the shell's realm, whatever system the
//! device runs. The shell asks the runtime, never the operating system:
//! `globalThis.wifi` is PocketJS's `system.wifi` (contracts/spec/wifi.ts in
//! vendor/pocketjs), and each device program answers it with a provider for
//! its own system:
//!
//!   the RG DS Plus (Linux)   `DaemonWifi` here: omarchy-pocketd's
//!                            NetworkManager calls over the bridge
//!   the AYN Thor (Android)   android.rs `AndroidWifi`: WifiManager in the
//!                            app, over JNI
//!
//! A new device adapts the providers once; the shell's Wi-Fi panel and
//! anything else on the module work there unchanged. Every op returns at
//! once: status() serves the provider's last reading and an action's outcome
//! shows in later reads, as the contract has it.
use rquickjs::{Ctx, Function, Object};
use std::{cell::RefCell, rc::Rc};

/// `system.wifi` on one system. Slots index `WifiStatus.saved` as the last
/// status() reported it.
pub trait Wifi {
    /// JSON WifiStatus
    fn status(&mut self) -> String;
    fn set_enabled(&mut self, on: bool) -> bool;
    fn connect(&mut self, slot: u32) -> bool;
    fn scan(&mut self) -> bool;
    fn join(&mut self, ssid: &str, passphrase: &str) -> bool;
    fn forget(&mut self, slot: u32) -> bool;
    fn disconnect(&mut self) -> bool;
    /// The system has Wi-Fi settings of its own (`openSettings` is installed).
    fn has_settings(&self) -> bool {
        false
    }
    /// The system's own Wi-Fi settings; false where it has none to show.
    fn open_settings(&mut self) -> bool {
        false
    }
    /// A daemon line meant for this provider; true when it was.
    fn reply(&mut self, _line: &str) -> bool {
        false
    }
    /// The bridge to the daemon dropped: every request it held is lost.
    fn daemon_lost(&mut self) {}
}

pub type SharedWifi = Rc<RefCell<dyn Wifi>>;

/// Installs `globalThis.wifi` over `wifi`, with every op of the contract.
pub fn install_wifi<'js>(ctx: &Ctx<'js>, wifi: SharedWifi) -> rquickjs::Result<()> {
    let object = Object::new(ctx.clone())?;
    let w = wifi.clone();
    object.set("status", Function::new(ctx.clone(), move || w.borrow_mut().status())?)?;
    let w = wifi.clone();
    object.set("setEnabled", Function::new(ctx.clone(), move |on: bool| w.borrow_mut().set_enabled(on))?)?;
    let w = wifi.clone();
    object.set("connect", Function::new(ctx.clone(), move |slot: i32| slot >= 0 && w.borrow_mut().connect(slot as u32))?)?;
    let w = wifi.clone();
    object.set("scan", Function::new(ctx.clone(), move || w.borrow_mut().scan())?)?;
    let w = wifi.clone();
    object.set(
        "join",
        Function::new(ctx.clone(), move |ssid: String, passphrase: String| {
            !ssid.is_empty() && ssid.len() <= 32 && passphrase.len() <= 63 && w.borrow_mut().join(&ssid, &passphrase)
        })?,
    )?;
    let w = wifi.clone();
    object.set("forget", Function::new(ctx.clone(), move |slot: i32| slot >= 0 && w.borrow_mut().forget(slot as u32))?)?;
    let w = wifi.clone();
    object.set("disconnect", Function::new(ctx.clone(), move || w.borrow_mut().disconnect())?)?;
    if wifi.borrow().has_settings() {
        let w = wifi;
        object.set("openSettings", Function::new(ctx.clone(), move || w.borrow_mut().open_settings())?)?;
    }
    ctx.globals().set("wifi", object)
}

// ---- Linux: omarchy-pocketd's NetworkManager --------------------------------

#[cfg(not(target_os = "android"))]
pub use daemon::DaemonWifi;

#[cfg(not(target_os = "android"))]
mod daemon {
    use super::Wifi;
    use crate::bridge::Bridge;
    use crate::net::json_string;
    use std::{
        cell::RefCell,
        collections::HashMap,
        rc::Rc,
        time::{Duration, Instant},
    };


    /// What a request to the daemon was for.
    enum Asked {
        Status,
        Action,
    }

    /// `system.wifi` through omarchy-pocketd (daemon/panels.ts: nmcli). Requests
    /// go on the shell's bridge with ids `"system:<n>"`, which the shell never
    /// uses; the guest hands their replies here before the shell sees its lines.
    pub struct DaemonWifi {
        bridge: Rc<RefCell<Bridge>>,
        /// the last WifiStatus the daemon reported
        status: serde_json::Value,
        asked_at: Option<Instant>,
        status_pending: bool,
        pending: HashMap<u64, Asked>,
        next: u64,
        scanning: bool,
        /// the last refused action's reason, until the next action
        error: String,
    }

    /// A status the shell sees while the daemon is away.
    const ABSENT: &str = r#"{"state":"off","ssid":"","strength":0,"address":"","saved":[],"error":"","networks":[]}"#;
    /// status() reads the daemon again at most this often.
    const STATUS_EVERY: Duration = Duration::from_secs(2);
    const REPLY_PREFIX: &str = r#"{"id":"system:"#;

    impl DaemonWifi {
        pub fn new(bridge: Rc<RefCell<Bridge>>) -> Self {
            Self {
                bridge,
                status: serde_json::from_str(ABSENT).unwrap(),
                asked_at: None,
                status_pending: false,
                pending: HashMap::new(),
                next: 0,
                scanning: false,
                error: String::new(),
            }
        }

        fn send(&mut self, asked: Asked, body: &str) {
            self.next += 1;
            let id = self.next;
            self.pending.insert(id, asked);
            let comma = if body.is_empty() { "" } else { "," };
            self.bridge.borrow_mut().send(&format!(r#"{{"id":"system:{id}"{comma}{body}}}"#));
        }

        fn ask_status(&mut self, method: &str) {
            self.status_pending = true;
            self.asked_at = Some(Instant::now());
            self.send(Asked::Status, &format!(r#""method":{}"#, json_string(method)));
        }

        fn action(&mut self, body: String) -> bool {
            self.error.clear();
            self.send(Asked::Action, &body);
            true
        }

        /// The SSID saved connection `slot` names in the last status.
        fn saved_ssid(&self, slot: u32) -> Option<String> {
            self.status["saved"].as_array()?.iter().find(|s| s["slot"].as_u64() == Some(slot as u64))?["ssid"].as_str().map(str::to_owned)
        }
    }

    impl Wifi for DaemonWifi {
        fn status(&mut self) -> String {
            if !self.status_pending && self.asked_at.is_none_or(|at| at.elapsed() >= STATUS_EVERY) {
                self.ask_status("wifiStatus");
            }
            let mut status = self.status.clone();
            if !self.error.is_empty() {
                status["error"] = self.error.clone().into();
            }
            if self.scanning {
                status["scanning"] = true.into();
            }
            status.to_string()
        }
        fn set_enabled(&mut self, on: bool) -> bool {
            self.action(format!(r#""method":"wifiPower","on":{on}"#))
        }
        fn connect(&mut self, slot: u32) -> bool {
            let Some(ssid) = self.saved_ssid(slot) else { return false };
            self.action(format!(r#""method":"wifiConnect","ssid":{}"#, json_string(&ssid)))
        }
        fn scan(&mut self) -> bool {
            self.scanning = true;
            self.ask_status("wifiScan");
            true
        }
        fn join(&mut self, ssid: &str, passphrase: &str) -> bool {
            self.action(format!(r#""method":"wifiJoin","ssid":{},"passphrase":{}"#, json_string(ssid), json_string(passphrase)))
        }
        fn forget(&mut self, slot: u32) -> bool {
            let Some(ssid) = self.saved_ssid(slot) else { return false };
            self.action(format!(r#""method":"wifiForget","ssid":{}"#, json_string(&ssid)))
        }
        fn disconnect(&mut self) -> bool {
            self.action(r#""method":"wifiDisconnect""#.into())
        }
        fn reply(&mut self, line: &str) -> bool {
            if !line.starts_with(REPLY_PREFIX) {
                return false;
            }
            let Ok(reply) = serde_json::from_str::<serde_json::Value>(line) else { return true };
            let Some(id) = reply["id"].as_str().and_then(|id| id.strip_prefix("system:")).and_then(|n| n.parse::<u64>().ok()) else { return true };
            let ok = reply["ok"].as_bool() == Some(true);
            match self.pending.remove(&id) {
                Some(Asked::Status) => {
                    self.status_pending = false;
                    self.scanning = false;
                    if ok {
                        self.status = reply["result"].clone();
                    }
                }
                Some(Asked::Action) => {
                    if !ok {
                        self.error = reply["error"].as_str().unwrap_or("the system refused").to_owned();
                    }
                    // the action shows in the next reading
                    self.asked_at = None;
                }
                None => {}
            }
            true
        }
        fn daemon_lost(&mut self) {
            self.pending.clear();
            self.status_pending = false;
            self.scanning = false;
            self.asked_at = None;
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn wifi() -> (Rc<RefCell<Bridge>>, DaemonWifi) {
            let bridge = Rc::new(RefCell::new(Bridge::new(None)));
            (bridge.clone(), DaemonWifi::new(bridge))
        }

        #[test]
        fn status_reads_the_daemon_and_serves_its_answer() {
            let (bridge, mut wifi) = wifi();
            let first: serde_json::Value = serde_json::from_str(&wifi.status()).unwrap();
            assert_eq!(first["state"], "off");
            assert_eq!(bridge.borrow().queued(), "{\"id\":\"system:1\",\"method\":\"wifiStatus\"}\n");
            // one reading at a time
            wifi.status();
            assert_eq!(bridge.borrow().queued().lines().count(), 1);
            let answer = r#"{"id":"system:1","ok":true,"result":{"state":"connected","ssid":"Home","strength":3,"address":"10.0.0.2","saved":[{"slot":0,"ssid":"Home"},{"slot":1,"ssid":"Café"}],"error":"","networks":[]}}"#;
            assert!(wifi.reply(answer));
            let status: serde_json::Value = serde_json::from_str(&wifi.status()).unwrap();
            assert_eq!(status["ssid"], "Home");
            // the shell's own lines are not the provider's
            assert!(!wifi.reply(r#"{"id":7,"ok":true,"result":null}"#));
        }

        #[test]
        fn actions_name_saved_networks_by_slot_and_report_refusals() {
            let (bridge, mut wifi) = wifi();
            wifi.status();
            wifi.reply(r#"{"id":"system:1","ok":true,"result":{"state":"idle","ssid":"","strength":0,"address":"","saved":[{"slot":0,"ssid":"Home"},{"slot":1,"ssid":"Café \"5G\""}],"error":"","networks":[]}}"#);
            assert!(wifi.connect(1));
            assert!(!wifi.forget(2));
            assert!(bridge.borrow().queued().ends_with("{\"id\":\"system:2\",\"method\":\"wifiConnect\",\"ssid\":\"Café \\\"5G\\\"\"}\n"));
            assert!(wifi.reply(r#"{"id":"system:2","ok":false,"error":"Secrets were required"}"#));
            let status: serde_json::Value = serde_json::from_str(&wifi.status()).unwrap();
            assert_eq!(status["error"], "Secrets were required");
            // the refusal asked for a fresh reading
            assert!(bridge.borrow().queued().ends_with("{\"id\":\"system:3\",\"method\":\"wifiStatus\"}\n"));
            assert!(wifi.join("Office", "hunter22"));
            assert!(wifi.reply(r#"{"id":"system:4","ok":true,"result":null}"#));
            let status: serde_json::Value = serde_json::from_str(&wifi.status()).unwrap();
            assert_eq!(status["error"], "");
        }

        #[test]
        fn a_scan_shows_until_its_answer() {
            let (_, mut wifi) = wifi();
            assert!(wifi.scan());
            let status: serde_json::Value = serde_json::from_str(&wifi.status()).unwrap();
            assert_eq!(status["scanning"], true);
            wifi.reply(r#"{"id":"system:1","ok":true,"result":{"state":"idle","ssid":"","strength":0,"address":"","saved":[],"error":"","networks":[{"ssid":"Home","strength":2,"secure":true,"signal":60,"saved":true}]}}"#);
            let status: serde_json::Value = serde_json::from_str(&wifi.status()).unwrap();
            assert!(status.get("scanning").is_none());
            assert_eq!(status["networks"][0]["ssid"], "Home");
            wifi.daemon_lost();
            assert!(wifi.pending.is_empty());
        }
    }
}
