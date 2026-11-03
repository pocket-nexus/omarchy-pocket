//! spotatui finds Cast and Spotify Connect speakers on the LAN that are not
//! signed in; this device lists the account's devices only.
use md5::{Digest, Md5};
use std::net::SocketAddr;

pub struct CastDevice {
  pub name: String,
  pub address: SocketAddr,
  pub video: bool,
}

impl CastDevice {
  /// The Connect device id that the Spotify receiver registers: the MD5 of the name.
  pub fn connect_id(&self) -> String {
    Md5::digest(self.name.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
  }
}

pub struct ConnectSpeaker {
  pub name: String,
  pub url: String,
  pub device_id: String,
  pub device_type: String,
}

pub fn start() {}

pub fn cast_devices() -> Vec<CastDevice> {
  Vec::new()
}

pub fn connect_speakers() -> Vec<ConnectSpeaker> {
  Vec::new()
}
