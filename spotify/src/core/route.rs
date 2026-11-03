//! How the sessions reach Spotify: through the proxy the environment names
//! (mihomo's, when it runs) or directly. Spotify refuses a login from a
//! country the account does not match ("Travel restriction"), and a proxy's
//! node can be in another one, so a sign-in tries the other route when the
//! first is refused, and the route that worked is kept in <dir>/route.
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

static DIRECT: AtomicBool = AtomicBool::new(false);

pub fn direct() -> bool {
  DIRECT.load(Ordering::Relaxed)
}

pub fn set(dir: &Path, direct: bool) {
  DIRECT.store(direct, Ordering::Relaxed);
  let _ = std::fs::write(dir.join("route"), if direct { "direct" } else { "proxy" });
}

pub fn load(dir: &Path) {
  let kept = std::fs::read_to_string(dir.join("route")).unwrap_or_default();
  DIRECT.store(kept.trim() == "direct", Ordering::Relaxed);
}

/// The environment names a proxy at all.
pub fn proxy_named() -> bool {
  ["https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY"].iter().any(|name| std::env::var(name).is_ok_and(|v| !v.is_empty()))
}
