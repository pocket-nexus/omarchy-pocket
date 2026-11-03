//! spotatui moves old caches; this device has none.
use std::path::Path;

pub fn migrate_legacy_path_if_unclaimed(_from: &Path, _to: &Path) -> anyhow::Result<bool> {
  Ok(false)
}
