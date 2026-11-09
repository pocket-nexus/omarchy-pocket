//! Installs the app's Linux root from a .tar.zst (tools/android.ts rootfs)
//! into the app's files. The archive is the RG DS Plus image's root as root
//! made it; the app writes it as itself:
//!
//! - ownership is dropped: every file belongs to the app's uid, and proot
//!   (`-i 1000:1000`) shows the Omarchy user its own files;
//! - modes keep their permission bits, with the owner's read and write (and
//!   search on directories) added so the app can update and remove what it
//!   wrote; setuid and setgid bits go;
//! - a hard link the app's SELinux domain refuses becomes a copy;
//! - device nodes and FIFOs are skipped: proot binds Android's /dev;
//! - a PAX sparse file (format 1.0: GNU.sparse.name, .realsize and a map
//!   ahead of the data, as bsdtar writes pocket-rime and glibc's
//!   locale-archive) is written whole under its real name.
//!
//! The archive's entries are confined to the destination: an absolute path
//! is taken relative to it and a `..` component refuses the entry.
use std::{
    cell::Cell,
    fs, io,
    io::{Read, Seek, SeekFrom, Write},
    os::unix::fs::{symlink, PermissionsExt},
    path::{Component, Path, PathBuf},
    rc::Rc,
};

/// Counts the compressed bytes read, for the progress the app shows.
struct Counted<R> {
    inner: R,
    read: Rc<Cell<u64>>,
}

impl<R: Read> Read for Counted<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.read.set(self.read.get() + n as u64);
        Ok(n)
    }
}

/// The entry's path under `root`, or None for one that would leave it.
fn confined(root: &Path, path: &Path) -> Option<PathBuf> {
    let mut out = root.to_path_buf();
    for part in path.components() {
        match part {
            Component::Normal(name) => out.push(name),
            Component::CurDir | Component::RootDir => {}
            Component::ParentDir | Component::Prefix(_) => return None,
        }
    }
    Some(out)
}

fn replace(path: &Path) {
    if let Ok(meta) = fs::symlink_metadata(path) {
        if meta.is_dir() && !meta.file_type().is_symlink() {
            return;
        }
        let _ = fs::remove_file(path);
    }
}

/// A PAX sparse file's real name and size (format 1.0), from its extended header.
fn sparse<R: Read>(entry: &mut tar::Entry<'_, R>) -> io::Result<Option<(String, u64)>> {
    let Some(extensions) = entry.pax_extensions()? else { return Ok(None) };
    let (mut major, mut name, mut size) = (None, None, None);
    for extension in extensions {
        let extension = extension?;
        let value = extension.value().unwrap_or_default().to_string();
        match extension.key().unwrap_or_default() {
            "GNU.sparse.major" => major = Some(value),
            "GNU.sparse.name" => name = Some(value),
            "GNU.sparse.realsize" => size = value.parse().ok(),
            _ => {}
        }
    }
    Ok(match (major.as_deref(), name, size) {
        (Some("1"), Some(name), Some(size)) => Some((name, size)),
        _ => None,
    })
}

/// Writes a sparse file's data: its map (decimal lines: the count, then an
/// offset and a length for each region, padded to 512 bytes), then the
/// regions one after another.
fn write_sparse(entry: &mut impl Read, out: &mut fs::File, size: u64) -> io::Result<()> {
    let mut numbers: Vec<u64> = Vec::new();
    let mut digits = String::new();
    let mut block = [0u8; 512];
    'map: loop {
        entry.read_exact(&mut block)?;
        for &b in &block {
            if b == b'\n' {
                numbers.push(digits.parse().map_err(|_| io::Error::other("bad sparse map"))?);
                digits.clear();
                if numbers.len() > 1 && numbers.len() as u64 == 1 + 2 * numbers[0] {
                    break 'map;
                }
            } else if b.is_ascii_digit() {
                digits.push(b as char);
            }
        }
        if numbers.len() == 1 && numbers[0] == 0 {
            break;
        }
    }
    for region in numbers[1..].chunks_exact(2) {
        out.seek(SeekFrom::Start(region[0]))?;
        io::copy(&mut entry.take(region[1]), out)?;
    }
    out.set_len(size)?;
    out.flush()
}

/// Unpacks `archive` into `root`; `progress(read, total)` hears the
/// compressed bytes read about every 4 MB.
pub fn install(archive: &Path, root: &Path, mut progress: impl FnMut(u64, u64)) -> io::Result<u64> {
    let total = fs::metadata(archive)?.len();
    fs::create_dir_all(root)?;
    let file = fs::File::open(archive)?;
    let read = Rc::new(Cell::new(0));
    let counted = Counted { inner: io::BufReader::with_capacity(1 << 20, file), read: read.clone() };
    let decoder = zstd::stream::read::Decoder::new(counted)?;
    let mut tar = tar::Archive::new(decoder);
    let mut entries = 0u64;
    let mut reported = 0u64;
    // directories get their modes after their contents are written
    let mut directories: Vec<(PathBuf, u32)> = Vec::new();
    for entry in tar.entries()? {
        let mut entry = entry?;
        let header = entry.header();
        let kind = header.entry_type();
        let mode = header.mode().unwrap_or(0o644) & 0o777;
        let sparse = if kind.is_file() { sparse(&mut entry)? } else { None };
        let name = match &sparse {
            Some((name, _)) => PathBuf::from(name),
            None => entry.path()?.into_owned(),
        };
        let Some(path) = confined(root, &name) else { continue };
        if path == root {
            continue;
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        match kind {
            tar::EntryType::Directory => {
                fs::create_dir_all(&path)?;
                fs::set_permissions(&path, fs::Permissions::from_mode(0o700))?;
                directories.push((path, mode | 0o700));
            }
            tar::EntryType::Regular | tar::EntryType::Continuous => {
                replace(&path);
                let mut out = fs::File::create(&path)?;
                match sparse {
                    Some((_, size)) => write_sparse(&mut entry, &mut out, size)?,
                    None => {
                        io::copy(&mut entry, &mut out)?;
                    }
                }
                out.set_permissions(fs::Permissions::from_mode(mode | 0o600))?;
            }
            tar::EntryType::Symlink => {
                let Some(target) = entry.link_name()? else { continue };
                replace(&path);
                symlink(&*target, &path)?;
            }
            tar::EntryType::Link => {
                let Some(target) = entry.link_name()?.and_then(|t| confined(root, &t)) else { continue };
                replace(&path);
                if fs::hard_link(&target, &path).is_err() {
                    fs::copy(&target, &path)?;
                }
            }
            // device nodes, FIFOs, extended headers: nothing to write
            _ => continue,
        }
        entries += 1;
        if read.get() >= reported + (4 << 20) {
            reported = read.get();
            progress(reported, total);
        }
    }
    for (path, mode) in directories.into_iter().rev() {
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(mode));
    }
    progress(total, total);
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entries_stay_under_the_root() {
        let root = Path::new("/r");
        assert_eq!(confined(root, Path::new("./usr/bin/bun")), Some(PathBuf::from("/r/usr/bin/bun")));
        assert_eq!(confined(root, Path::new("/etc/passwd")), Some(PathBuf::from("/r/etc/passwd")));
        assert_eq!(confined(root, Path::new("usr/../../etc")), None);
    }
}
