//! Where the credentials live: the directory omarchy-pocketd names with
//! `--cache` (its services/spotify/session/), mode 0700.
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static CACHE: OnceLock<PathBuf> = OnceLock::new();

pub fn set_cache_dir(path: PathBuf) {
  let _ = CACHE.set(path);
}

pub fn app_cache_dir() -> Option<PathBuf> {
  CACHE.get().cloned()
}

pub fn app_config_dir() -> Option<PathBuf> {
  None
}

pub fn ensure_private_dir(path: &Path) -> anyhow::Result<()> {
  use std::os::unix::fs::PermissionsExt;
  std::fs::create_dir_all(path)?;
  std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
  Ok(())
}
