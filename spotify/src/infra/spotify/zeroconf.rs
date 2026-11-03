//! See lan.rs: no network speakers are signed in from here.
use super::session::SpotifySession;

pub async fn log_in(_session: &SpotifySession, url: &str) -> anyhow::Result<()> {
  Err(anyhow::anyhow!("{url} is a network speaker, which this device does not sign in"))
}
