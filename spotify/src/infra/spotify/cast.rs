//! See lan.rs: no Cast speakers here.
use super::lan::CastDevice;
use super::session::SpotifySession;

pub async fn log_in(_session: &SpotifySession, device: &CastDevice) -> anyhow::Result<()> {
  Err(anyhow::anyhow!("{} is a Cast speaker, which this device does not sign in", device.name))
}
