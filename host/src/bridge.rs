//! The host end of the Omarchy bridge: newline-delimited JSON between the
//! shell's realm and omarchy-pocketd over a Unix socket. The program never
//! blocks on it: each tick reads what arrived and writes what is queued, and a
//! missing or closed socket is retried once a second. Lines the shell sends
//! while the daemon is away wait in the queue (up to QUEUE_LIMIT bytes).
use std::{
    collections::VecDeque,
    io::{ErrorKind, Read, Write},
    os::unix::net::UnixStream,
    path::PathBuf,
    time::{Duration, Instant},
};

const QUEUE_LIMIT: usize = 4 * 1024 * 1024;
const LINE_LIMIT: usize = 16 * 1024 * 1024;
const RETRY: Duration = Duration::from_secs(1);

pub struct Bridge {
    path: Option<PathBuf>,
    stream: Option<UnixStream>,
    next_attempt: Instant,
    outgoing: VecDeque<u8>,
    incoming: Vec<u8>,
    connected_once: bool,
    /// the connection closed since the last take_dropped()
    dropped: bool,
}

impl Bridge {
    /// `None` is a bridge that never connects (the --shot runs).
    pub fn new(path: Option<PathBuf>) -> Self {
        Self {
            path,
            stream: None,
            next_attempt: Instant::now(),
            outgoing: VecDeque::new(),
            incoming: Vec::new(),
            connected_once: false,
            dropped: false,
        }
    }

    pub fn send(&mut self, line: &str) {
        if self.outgoing.len() + line.len() + 1 > QUEUE_LIMIT {
            eprintln!("omarchy-pocket-host: bridge queue full, dropping a {}-byte line", line.len());
            return;
        }
        self.outgoing.extend(line.as_bytes());
        self.outgoing.push_back(b'\n');
    }

    fn connect(&mut self) {
        let Some(path) = &self.path else { return };
        if self.stream.is_some() || Instant::now() < self.next_attempt {
            return;
        }
        self.next_attempt = Instant::now() + RETRY;
        match UnixStream::connect(path) {
            Ok(stream) if stream.set_nonblocking(true).is_ok() => {
                eprintln!("omarchy-pocket-host: bridge connected at {}", path.display());
                self.stream = Some(stream);
                self.incoming.clear();
                self.connected_once = true;
            }
            Ok(_) => {}
            Err(error) => {
                if !self.connected_once {
                    // stay quiet after the first report; the daemon may start later
                    self.connected_once = true;
                    eprintln!("omarchy-pocket-host: bridge {}: {error}", path.display());
                }
            }
        }
    }

    fn drop_stream(&mut self, why: &str) {
        if self.stream.take().is_some() {
            eprintln!("omarchy-pocket-host: bridge closed ({why})");
            self.dropped = true;
        }
        self.incoming.clear();
        self.next_attempt = Instant::now() + RETRY;
    }

    /// Whether the connection closed since the last call: the daemon lost
    /// every request it had not answered.
    pub fn take_dropped(&mut self) -> bool {
        std::mem::take(&mut self.dropped)
    }

    /// Writes what is queued and returns the complete lines that arrived.
    pub fn poll(&mut self) -> Vec<String> {
        self.connect();
        let mut lines = Vec::new();
        let Some(stream) = self.stream.as_mut() else { return lines };
        let mut failure = None;
        while !self.outgoing.is_empty() {
            let (front, _) = self.outgoing.as_slices();
            match stream.write(front) {
                Ok(0) => {
                    failure = Some("write returned 0");
                    break;
                }
                Ok(n) => {
                    self.outgoing.drain(..n);
                }
                Err(e) if e.kind() == ErrorKind::WouldBlock => break,
                Err(e) if e.kind() == ErrorKind::Interrupted => continue,
                Err(_) => {
                    failure = Some("write failed");
                    break;
                }
            }
        }
        let mut buffer = [0u8; 65536];
        while failure.is_none() {
            match stream.read(&mut buffer) {
                Ok(0) => failure = Some("daemon closed the socket"),
                Ok(n) => {
                    self.incoming.extend_from_slice(&buffer[..n]);
                    if self.incoming.len() > LINE_LIMIT {
                        failure = Some("line exceeds 16 MiB");
                    }
                }
                Err(e) if e.kind() == ErrorKind::WouldBlock => break,
                Err(e) if e.kind() == ErrorKind::Interrupted => continue,
                Err(_) => failure = Some("read failed"),
            }
        }
        while let Some(end) = self.incoming.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = self.incoming.drain(..=end).collect();
            match String::from_utf8(line[..line.len() - 1].to_vec()) {
                Ok(text) if !text.is_empty() => lines.push(text),
                Ok(_) => {}
                Err(_) => eprintln!("omarchy-pocket-host: bridge line is not UTF-8"),
            }
        }
        if let Some(why) = failure {
            self.drop_stream(why);
        }
        lines
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::net::UnixListener;

    #[test]
    fn lines_cross_both_ways_and_survive_a_daemon_restart() {
        let dir = std::env::temp_dir().join(format!("omarchy-bridge-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("bridge.sock");
        let _ = std::fs::remove_file(&path);
        let mut bridge = Bridge::new(Some(path.clone()));
        bridge.send("{\"id\":1}");
        assert!(bridge.poll().is_empty()); // no daemon yet: the line waits
        let listener = UnixListener::bind(&path).unwrap();
        bridge.next_attempt = Instant::now();
        bridge.poll();
        let (mut daemon, _) = listener.accept().unwrap();
        let mut got = [0u8; 9];
        daemon.read_exact(&mut got).unwrap();
        assert_eq!(&got, b"{\"id\":1}\n");
        daemon.write_all(b"{\"a\":1}\n{\"b\"").unwrap();
        std::thread::sleep(Duration::from_millis(20));
        assert_eq!(bridge.poll(), vec!["{\"a\":1}".to_string()]);
        daemon.write_all(b":2}\n").unwrap();
        std::thread::sleep(Duration::from_millis(20));
        assert_eq!(bridge.poll(), vec!["{\"b\":2}".to_string()]);
        drop(daemon);
        std::thread::sleep(Duration::from_millis(20));
        assert!(bridge.poll().is_empty());
        assert!(bridge.stream.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
