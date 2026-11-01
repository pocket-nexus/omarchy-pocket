//! `globalThis.media` for an app's realm: the playback plane of
//! vendor/pocketjs/contracts/spec/media.ts (`MediaOps`), fed by the companion
//! media stream the daemon's services publish (`createMediaStreamServer` in
//! vendor/pocketjs/tools/media-stream.ts, on 127.0.0.1 here).
//!
//! Three parts share one `State`. The reader thread connects to the stream,
//! hands over its ticket, reads the PKMV header and the packets, decodes two
//! picture formats, `rgb565` (whole 512 x 256 frames in the core's PSM_5650
//! layout, red in the low five bits, this host's own) and `pal8` (a
//! palettized reference picture updated by runs, the format consoles without
//! a decoder take; its palette is RGB565 with red in the high bits, swapped
//! into the core's layout here), decodes the audio blocks (22,050 Hz
//! stereo IMA ADPCM) and queues both; it never waits on the app. H.264 has
//! no decoder here and is refused in the status, so the applet asks for
//! another format. The audio thread writes the queued PCM to PipeWire
//! through `pw-play --raw`, which takes it at the sample rate: **the audio
//! written is the clock**, less what pw-play still holds. The app's tick
//! (`Player::tick`, from children.rs before the app's frame) copies the
//! newest frame whose time has come into the plane texture, a core RGB565
//! texture the app binds to an Image with `setImage(id, media.texture())`.
//! Without audio in the stream, the wall clock paces the frames.
use crate::net::json_string;
use pocket_runtime::OpContext;
use rquickjs::{Ctx, Function, Object};
use std::{
    cell::RefCell,
    collections::VecDeque,
    io::{ErrorKind, Read, Write},
    net::{SocketAddr, TcpStream},
    process::{Child, Command, Stdio},
    rc::Rc,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

pub const WIDTH: usize = 512;
pub const HEIGHT: usize = 256;
const FRAME_BYTES: usize = WIDTH * HEIGHT * 2;
const SAMPLE_RATE: u32 = 22050;
const AUDIO_FRAMES: usize = 1024;
const MAGIC: u32 = 0x564d_4b50;
const CODEC_H264: u16 = 1;
const CODEC_PAL8: u16 = 2;
const CODEC_RGB565: u16 = 3;
const PACKET_VIDEO: u8 = 1;
const PACKET_AUDIO: u8 = 2;
const PACKET_END: u8 = 3;
const PACKET_ERROR: u8 = 4;
/// The largest video packet: one rgb565 frame behind its 8-byte header.
const VIDEO_PACKET_MAX: usize = FRAME_BYTES + 8;
/// Decoded frames waiting for their time (24 a second): the reader waits
/// past this, so the stream runs no further ahead than the queues hold.
const FRAME_QUEUE: usize = 16;
/// Decoded audio blocks waiting for the speaker (46 ms each): 0.65 s.
const AUDIO_QUEUE: usize = 14;
/// What pw-play holds before the speaker: the sound lags the samples written
/// by about this much, so the clock runs that far behind them.
const OUTPUT_LATENCY_MS: u32 = 80;
/// Audio queued before the first block is written.
const PREBUFFER_MS: u32 = 250;
/// A stream that sends nothing for this long has failed.
const STALL: Duration = Duration::from_secs(20);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Phase {
    Idle,
    Opening,
    Buffering,
    Playing,
    Ended,
    Error,
}

impl Phase {
    fn name(self) -> &'static str {
        match self {
            Phase::Idle => "idle",
            Phase::Opening => "opening",
            Phase::Buffering => "buffering",
            Phase::Playing => "playing",
            Phase::Ended => "ended",
            Phase::Error => "error",
        }
    }
}

/// The stream's state, shared by the reader, the audio thread and the app.
struct State {
    phase: Phase,
    error: String,
    /// decoded frames in timestamp order: (pts ms, RGB565 512 x 256)
    frames: VecDeque<(u32, Vec<u8>)>,
    /// decoded audio blocks in order: (pts ms, PCM s16 stereo bytes)
    audio: VecDeque<(u32, Vec<u8>)>,
    /// the stream has audio; its clock is `audio_written_ms`
    has_audio: bool,
    /// timestamp just past the last audio block written to pw-play
    audio_written_ms: u32,
    /// the first audio block's timestamp, for the prebuffer
    audio_first_ms: Option<u32>,
    /// without audio: the wall clock at the first frame, and its timestamp
    wall_origin: Option<(Instant, u32)>,
    audio_out: bool,
    /// pw-play could not start or took no more: the stream plays muted
    audio_failed: bool,
    /// the producer sent its end; the queues drain before the phase ends
    ended: bool,
    received: u64,
    decoded: u32,
    presented: u32,
    dropped: u32,
    decode_max_us: u32,
    underruns: u32,
    /// the frame on the texture
    shown_ms: u32,
}

impl State {
    fn new() -> Self {
        Self {
            phase: Phase::Idle,
            error: String::new(),
            frames: VecDeque::new(),
            audio: VecDeque::new(),
            has_audio: false,
            audio_written_ms: 0,
            audio_first_ms: None,
            wall_origin: None,
            audio_out: false,
            audio_failed: false,
            ended: false,
            received: 0,
            decoded: 0,
            presented: 0,
            dropped: 0,
            decode_max_us: 0,
            underruns: 0,
            shown_ms: 0,
        }
    }

    /// The playback position the frames follow.
    fn position_ms(&self, paused: bool) -> u32 {
        if self.has_audio {
            self.audio_written_ms.saturating_sub(OUTPUT_LATENCY_MS).max(self.audio_first_ms.unwrap_or(0))
        } else if let Some((at, first)) = self.wall_origin {
            if paused {
                self.shown_ms
            } else {
                first.saturating_add(at.elapsed().as_millis() as u32)
            }
        } else {
            0
        }
    }

    /// Audio queued past the prebuffer, or the stream ended: the sound may start.
    fn prebuffered(&self) -> bool {
        self.ended
            || self.audio.back().map_or(false, |last| {
                last.0.saturating_sub(self.audio.front().map_or(last.0, |first| first.0)) >= PREBUFFER_MS
            })
    }

    fn fail(&mut self, why: &str) {
        if self.phase != Phase::Error {
            self.phase = Phase::Error;
            self.error = why.to_string();
        }
    }
}

/// A stream's controls, read by its threads.
struct Controls {
    abort: AtomicBool,
    paused: AtomicBool,
    /// volume as f32 bits, 0..=1
    volume: AtomicU32,
}

impl Controls {
    fn new(volume: f32) -> Arc<Self> {
        Arc::new(Self {
            abort: AtomicBool::new(false),
            paused: AtomicBool::new(false),
            volume: AtomicU32::new(volume.to_bits()),
        })
    }
}

pub struct Player {
    ops: OpContext,
    state: Arc<Mutex<State>>,
    controls: Arc<Controls>,
    threads: Vec<thread::JoinHandle<()>>,
    texture: i32,
    volume: f32,
}

pub type Handle = Rc<RefCell<Player>>;

impl Player {
    pub fn new(ops: OpContext) -> Handle {
        Rc::new(RefCell::new(Self {
            ops,
            state: Arc::new(Mutex::new(State::new())),
            controls: Controls::new(0.8),
            threads: Vec::new(),
            texture: -1,
            volume: 0.8,
        }))
    }

    /// MediaOps.open: ends the stream playing and starts this one. False when
    /// the plane texture cannot be made.
    fn open(&mut self, host: String, port: u16, token: String) -> bool {
        // The streams come from omarchy-pocketd on this device; a package does
        // not get a TCP connection to anywhere else.
        if host != "127.0.0.1" {
            return false;
        }
        self.close();
        if self.texture < 0 {
            let Ok(mut core) = self.ops.core_mut() else { return false };
            let black = vec![0u8; FRAME_BYTES];
            self.texture = core.ui.upload_texture(&black, WIDTH as u32, HEIGHT as u32, pocket_spec::psm::PSM_5650);
            if self.texture < 0 {
                return false;
            }
        }
        let state = Arc::new(Mutex::new(State::new()));
        state.lock().unwrap().phase = Phase::Opening;
        let controls = Controls::new(self.volume);
        self.state = state.clone();
        self.controls = controls.clone();
        let (reader_state, reader_controls) = (state.clone(), controls.clone());
        self.threads.push(thread::spawn(move || {
            if let Err(why) = read_stream(&host, port, &token, &reader_state, &reader_controls) {
                reader_state.lock().unwrap().fail(&why);
            }
        }));
        self.threads.push(thread::spawn(move || play_audio(&state, &controls)));
        true
    }

    fn close(&mut self) {
        self.controls.abort.store(true, Ordering::Relaxed);
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
        *self.state.lock().unwrap() = State::new();
    }

    fn paused(&self, value: bool) {
        self.controls.paused.store(value, Ordering::Relaxed);
    }

    fn volume(&mut self, value: f32) {
        self.volume = value.clamp(0.0, 1.0);
        self.controls.volume.store(self.volume.to_bits(), Ordering::Relaxed);
    }

    fn status(&self) -> String {
        let s = self.state.lock().unwrap();
        let paused = self.controls.paused.load(Ordering::Relaxed);
        let phase = match s.phase {
            Phase::Playing if paused => "paused",
            other => other.name(),
        };
        let position = s.position_ms(paused).max(s.shown_ms);
        let buffered = s.audio.back().map_or(0, |last| last.0.saturating_sub(s.audio_written_ms));
        format!(
            "{{\"phase\":\"{phase}\",\"positionMs\":{position},\"bufferedMs\":{buffered},\"decodedFrames\":{},\"presentedFrames\":{},\"droppedFrames\":{},\"receivedBytes\":{},\"decodeMaxUs\":{},\"audioUnderruns\":{},\"hardware\":false,\"h264\":false,\"rgb565\":true,\"audio\":{},\"error\":{}}}",
            s.decoded,
            s.presented,
            s.dropped,
            s.received,
            s.decode_max_us,
            s.underruns,
            !s.audio_failed,
            json_string(&s.error)
        )
    }

    /// Before the app's frame: the newest frame whose time has come goes on
    /// the texture. True when the texture changed, so the app presents.
    pub fn tick(&mut self) -> bool {
        if self.threads.is_empty() || self.texture < 0 {
            return false;
        }
        let paused = self.controls.paused.load(Ordering::Relaxed);
        let frame = {
            let mut s = self.state.lock().unwrap();
            if !matches!(s.phase, Phase::Playing | Phase::Ended) || paused {
                return false;
            }
            if !s.has_audio && s.wall_origin.is_none() {
                if let Some(&(pts, _)) = s.frames.front() {
                    s.wall_origin = Some((Instant::now(), pts));
                }
            }
            let now = s.position_ms(paused);
            let mut due = None;
            while let Some(&(pts, _)) = s.frames.front() {
                if pts > now {
                    break;
                }
                if due.is_some() {
                    s.dropped += 1;
                }
                due = s.frames.pop_front();
            }
            due
        };
        let Some((pts, pixels)) = frame else { return false };
        let Ok(mut core) = self.ops.core_mut() else {
            self.state.lock().unwrap().frames.push_front((pts, pixels));
            return false;
        };
        let written = core.ui.update_texture_rect(self.texture, 0, 0, WIDTH as u32, HEIGHT as u32, &pixels);
        drop(core);
        let mut s = self.state.lock().unwrap();
        if written {
            s.presented += 1;
            s.shown_ms = pts;
        }
        written
    }

    /// A stream is open and not at its end: the device stays awake for it.
    pub fn playing(&self) -> bool {
        !self.threads.is_empty() && matches!(self.state.lock().unwrap().phase, Phase::Opening | Phase::Buffering | Phase::Playing)
    }

    pub fn shutdown(&mut self) {
        self.close();
    }
}

/// Installs `globalThis.media` in an app's realm.
pub fn install<'js>(ctx: &Ctx<'js>, player: &Handle) -> rquickjs::Result<()> {
    let object = Object::new(ctx.clone())?;
    let p = player.clone();
    object.set(
        "open",
        Function::new(ctx.clone(), move |host: String, port: u32, token: String| -> bool {
            u16::try_from(port).is_ok_and(|port| p.borrow_mut().open(host, port, token))
        })?,
    )?;
    let p = player.clone();
    object.set("close", Function::new(ctx.clone(), move || p.borrow_mut().close())?)?;
    let p = player.clone();
    object.set("paused", Function::new(ctx.clone(), move |value: bool| p.borrow().paused(value))?)?;
    let p = player.clone();
    object.set("volume", Function::new(ctx.clone(), move |value: f64| p.borrow_mut().volume(value as f32))?)?;
    let p = player.clone();
    object.set("texture", Function::new(ctx.clone(), move || -> i32 { p.borrow().texture })?)?;
    let p = player.clone();
    object.set("status", Function::new(ctx.clone(), move || p.borrow().status())?)?;
    ctx.globals().set("media", object)
}

fn u16_at(p: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([p[at], p[at + 1]])
}

fn u32_at(p: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([p[at], p[at + 1], p[at + 2], p[at + 3]])
}

/// The PAL8 reference picture: palette as RGB565 and index bytes.
struct Pal8 {
    width: usize,
    height: usize,
    palette_set: bool,
    palette: [u16; 256],
    reference: Vec<u8>,
}

fn varint(p: &[u8], at: &mut usize) -> Option<usize> {
    let mut value = 0usize;
    for shift in [0, 7, 14] {
        let byte = *p.get(*at)?;
        *at += 1;
        value |= ((byte & 127) as usize) << shift;
        if byte & 128 == 0 {
            return Some(value);
        }
    }
    None
}

/// Applies one PAL8 packet; false when it is malformed.
fn pal8_apply(state: &mut Pal8, p: &[u8]) -> bool {
    if p.len() < 8 {
        return false;
    }
    let (w, h) = (u16_at(p, 0) as usize, u16_at(p, 2) as usize);
    let colors = u16_at(p, 4) as usize;
    if w == 0 || h == 0 || w > WIDTH || h > HEIGHT || u16_at(p, 6) != 0 || colors > 256 {
        return false;
    }
    if state.width != 0 && (w != state.width || h != state.height) {
        return false;
    }
    if colors == 0 && !state.palette_set {
        return false;
    }
    let mut at = 8 + colors * 2;
    if at > p.len() {
        return false;
    }
    for i in 0..colors {
        state.palette[i] = u16_at(p, 8 + i * 2);
    }
    if colors != 0 {
        state.palette_set = true;
    }
    state.width = w;
    state.height = h;
    let total = w * h;
    if state.reference.len() != total {
        state.reference = vec![0; total];
    }
    let mut pixel = 0;
    while pixel < total {
        let (Some(skip), Some(count)) = (varint(p, &mut at), varint(p, &mut at)) else {
            return false;
        };
        if pixel + skip + count > total || at + count > p.len() {
            return false;
        }
        pixel += skip;
        state.reference[pixel..pixel + count].copy_from_slice(&p[at..at + count]);
        pixel += count;
        at += count;
    }
    at == p.len()
}

/// The reference picture as a 512 x 256 RGB565 frame at the top-left, its
/// last column and row repeated once for filtered reads.
fn pal8_frame(state: &Pal8) -> Vec<u8> {
    let mut out = vec![0u8; FRAME_BYTES];
    let (w, h) = (state.width, state.height);
    for y in 0..h {
        let row = &state.reference[y * w..(y + 1) * w];
        let base = y * WIDTH * 2;
        for (x, &index) in row.iter().enumerate() {
            // the wire's RGB565 (red high) into PSM_5650 (red low)
            let c = state.palette[index as usize];
            let c = ((c & 0x1f) << 11) | (c & 0x7e0) | (c >> 11);
            let c = c.to_le_bytes();
            out[base + x * 2] = c[0];
            out[base + x * 2 + 1] = c[1];
        }
        if w < WIDTH {
            out.copy_within(base + (w - 1) * 2..base + w * 2, base + w * 2);
        }
    }
    if h < HEIGHT {
        let span = (w + usize::from(w < WIDTH)).min(WIDTH) * 2;
        out.copy_within((h - 1) * WIDTH * 2..(h - 1) * WIDTH * 2 + span, h * WIDTH * 2);
    }
    out
}

const IMA_STEPS: [u16; 89] = [
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130,
    143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166,
    1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132,
    7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
const IMA_INDEX: [i32; 8] = [-1, -1, -1, -1, 2, 4, 6, 8];

/// One stereo IMA ADPCM block into interleaved PCM; the frames decoded, 0
/// for a malformed block.
fn decode_audio(p: &[u8], out: &mut [i16]) -> usize {
    let n = p.len();
    if !(8..=AUDIO_FRAMES + 7).contains(&n) || p[2] > 88 || p[6] > 88 || p[3] != 0 || p[7] != 0 {
        return 0;
    }
    let frames = n - 7;
    if out.len() < frames * 2 {
        return 0;
    }
    let mut value = [u16_at(p, 0) as i16 as i32, u16_at(p, 4) as i16 as i32];
    let mut index = [p[2] as i32, p[6] as i32];
    out[0] = value[0] as i16;
    out[1] = value[1] as i16;
    for frame in 1..frames {
        for ch in 0..2 {
            let code = ((p[frame + 7] >> (ch * 4)) & 15) as i32;
            let step = IMA_STEPS[index[ch] as usize] as i32;
            let mut delta = step >> 3;
            if code & 4 != 0 {
                delta += step;
            }
            if code & 2 != 0 {
                delta += step >> 1;
            }
            if code & 1 != 0 {
                delta += step >> 2;
            }
            value[ch] = (value[ch] + if code & 8 != 0 { -delta } else { delta }).clamp(-32768, 32767);
            index[ch] = (index[ch] + IMA_INDEX[(code & 7) as usize]).clamp(0, 88);
            out[frame * 2 + ch] = value[ch] as i16;
        }
    }
    frames
}

/// pw-play taking raw PCM on stdin, or none when PipeWire cannot be reached.
fn open_speaker() -> Option<Child> {
    let latency = format!("{OUTPUT_LATENCY_MS}ms");
    Command::new("pw-play")
        .args(["--raw", "--format", "s16", "--rate", "22050", "--channels", "2", "--latency", &latency, "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()
}

/// Reads exactly `into.len()` bytes; Ok(false) when the stream was aborted,
/// Err after a stall.
fn read_all(socket: &mut TcpStream, into: &mut [u8], controls: &Controls) -> Result<bool, String> {
    let mut at = 0;
    let mut quiet = Instant::now();
    while at < into.len() {
        if controls.abort.load(Ordering::Relaxed) {
            return Ok(false);
        }
        match socket.read(&mut into[at..]) {
            Ok(0) => return Err("The media stream closed".into()),
            Ok(n) => {
                at += n;
                quiet = Instant::now();
            }
            Err(e) if e.kind() == ErrorKind::WouldBlock || e.kind() == ErrorKind::TimedOut => {
                if quiet.elapsed() > STALL {
                    return Err("The media stream stalled".into());
                }
            }
            Err(e) if e.kind() == ErrorKind::Interrupted => {}
            Err(e) => return Err(format!("The media stream failed: {e}")),
        }
    }
    Ok(true)
}

/// The reader: one stream from its connection to its end, into the queues.
fn read_stream(host: &str, port: u16, token: &str, state: &Arc<Mutex<State>>, controls: &Arc<Controls>) -> Result<(), String> {
    let address: SocketAddr = format!("{host}:{port}").parse().map_err(|_| "Invalid media source address".to_string())?;
    let mut socket = TcpStream::connect_timeout(&address, Duration::from_secs(10)).map_err(|e| format!("The companion's media stream is unreachable: {e}"))?;
    socket.set_nodelay(true).ok();
    socket.set_read_timeout(Some(Duration::from_millis(500))).ok();
    if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid media ticket".into());
    }
    socket.write_all(token.as_bytes()).map_err(|e| format!("The media ticket could not be sent: {e}"))?;
    let mut header = [0u8; 32];
    if !read_all(&mut socket, &mut header, controls)? {
        return Ok(());
    }
    if u32_at(&header, 0) != MAGIC || u16_at(&header, 4) != 1 || u16_at(&header, 6) != 32 {
        return Err("The media stream's header is not PKMV 1".into());
    }
    if u16_at(&header, 8) as usize != WIDTH || u16_at(&header, 10) as usize != HEIGHT {
        return Err("The media stream's plane is not 512 x 256".into());
    }
    let codec = u16_at(&header, 14);
    if codec == CODEC_H264 {
        return Err("H.264 needs a hardware decoder this device lacks".into());
    }
    if codec != CODEC_PAL8 && codec != CODEC_RGB565 {
        return Err("The media stream's picture format is unknown".into());
    }
    if u32_at(&header, 16) != SAMPLE_RATE || u16_at(&header, 20) != 2 || u16_at(&header, 22) != 2 {
        return Err("The media stream's sound is not 22,050 Hz stereo".into());
    }
    {
        let mut s = state.lock().unwrap();
        s.phase = Phase::Buffering;
        s.received = 32;
    }
    let mut pal8 = Pal8 { width: 0, height: 0, palette_set: false, palette: [0; 256], reference: Vec::new() };
    let mut pcm = vec![0i16; AUDIO_FRAMES * 2];
    let mut packet = [0u8; 16];
    let mut payload = Vec::with_capacity(VIDEO_PACKET_MAX);
    loop {
        if !read_all(&mut socket, &mut packet, controls)? {
            return Ok(());
        }
        let kind = packet[0];
        let length = u32_at(&packet, 4) as usize;
        let pts = u32_at(&packet, 8);
        let limit = match kind {
            PACKET_VIDEO => VIDEO_PACKET_MAX,
            PACKET_AUDIO => AUDIO_FRAMES + 7,
            PACKET_END => 0,
            PACKET_ERROR => 160,
            _ => return Err("The media stream sent an unknown packet".into()),
        };
        if packet[1] != 0 || u16_at(&packet, 2) != 0 || u32_at(&packet, 12) != 0 || length > limit {
            return Err("The media stream sent a malformed packet".into());
        }
        payload.resize(length, 0);
        if !read_all(&mut socket, &mut payload, controls)? {
            return Ok(());
        }
        // the packet is in: its credit goes back before it is decoded
        if socket.write_all(&[1]).is_err() {
            return Err("The media stream closed".into());
        }
        state.lock().unwrap().received += 16 + length as u64;
        match kind {
            PACKET_VIDEO => {
                let started = Instant::now();
                let frame = if codec == CODEC_RGB565 {
                    if length != VIDEO_PACKET_MAX || u16_at(&payload, 0) as usize != WIDTH || u16_at(&payload, 2) as usize != HEIGHT {
                        return Err("The media stream sent a frame of the wrong size".into());
                    }
                    payload[8..].to_vec()
                } else {
                    if !pal8_apply(&mut pal8, &payload) {
                        return Err("The media stream sent a malformed picture".into());
                    }
                    pal8_frame(&pal8)
                };
                let spent = started.elapsed().as_micros() as u32;
                // the queue holds what the app shows next: past that, wait
                loop {
                    {
                        let mut s = state.lock().unwrap();
                        s.decode_max_us = s.decode_max_us.max(spent);
                        if s.frames.len() < FRAME_QUEUE || s.phase == Phase::Error {
                            s.frames.push_back((pts, frame));
                            s.decoded += 1;
                            break;
                        }
                    }
                    if controls.abort.load(Ordering::Relaxed) {
                        return Ok(());
                    }
                    thread::sleep(Duration::from_millis(4));
                }
            }
            PACKET_AUDIO => {
                let frames = decode_audio(&payload, &mut pcm);
                if frames == 0 {
                    return Err("The media stream sent a malformed sound block".into());
                }
                let mut bytes = vec![0u8; frames * 4];
                for (i, sample) in pcm[..frames * 2].iter().enumerate() {
                    bytes[i * 2..i * 2 + 2].copy_from_slice(&sample.to_le_bytes());
                }
                // the queue holds two seconds: past that the speaker is behind
                loop {
                    {
                        let mut s = state.lock().unwrap();
                        if s.audio.len() < AUDIO_QUEUE {
                            s.has_audio = true;
                            s.audio_first_ms.get_or_insert(pts);
                            s.audio.push_back((pts, bytes));
                            break;
                        }
                    }
                    if controls.abort.load(Ordering::Relaxed) {
                        return Ok(());
                    }
                    thread::sleep(Duration::from_millis(5));
                }
            }
            PACKET_END => {
                state.lock().unwrap().ended = true;
                return Ok(());
            }
            _ => return Err(String::from_utf8_lossy(&payload).into_owned()),
        }
    }
}

/// The audio thread: queued PCM to pw-play at the sample rate, the phase's
/// start and end, and the clock.
fn play_audio(state: &Arc<Mutex<State>>, controls: &Arc<Controls>) {
    let mut speaker: Option<Child> = None;
    let mut started = false;
    let mut scaled = Vec::new();
    while !controls.abort.load(Ordering::Relaxed) {
        if controls.paused.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(10));
            continue;
        }
        let block = {
            let mut s = state.lock().unwrap();
            if s.phase == Phase::Error {
                break;
            }
            if !started {
                // sound and a picture, sound alone (a podcast: the plane stays black), or a silent picture
                let ready = s.phase == Phase::Buffering && s.has_audio && s.prebuffered();
                let silent = s.phase == Phase::Buffering && !s.has_audio && (s.frames.len() >= 2 || s.ended && !s.frames.is_empty());
                if ready || silent {
                    started = true;
                    s.phase = Phase::Playing;
                    if s.has_audio {
                        speaker = open_speaker();
                        s.audio_out = speaker.is_some();
                        s.audio_failed = speaker.is_none();
                    }
                } else {
                    drop(s);
                    thread::sleep(Duration::from_millis(5));
                    continue;
                }
            }
            match s.audio.pop_front() {
                Some(block) => block,
                None => {
                    if s.ended && s.frames.is_empty() && s.phase == Phase::Playing {
                        s.phase = Phase::Ended;
                    }
                    drop(s);
                    thread::sleep(Duration::from_millis(5));
                    continue;
                }
            }
        };
        let (pts, bytes) = block;
        let volume = f32::from_bits(controls.volume.load(Ordering::Relaxed)).clamp(0.0, 1.0);
        let gain = (volume * volume * 32768.0) as i32;
        scaled.clear();
        scaled.extend(bytes.chunks_exact(2).flat_map(|pair| {
            let sample = i16::from_le_bytes([pair[0], pair[1]]) as i32;
            (((sample * gain) >> 15).clamp(-32768, 32767) as i16).to_le_bytes()
        }));
        match speaker.as_mut().and_then(|child| child.stdin.as_mut()) {
            // pw-play takes the block when its buffer has room: real time
            Some(stdin) => {
                if stdin.write_all(&scaled).is_err() {
                    let mut s = state.lock().unwrap();
                    s.underruns += 1;
                    s.audio_out = false;
                    s.audio_failed = true;
                    speaker = None;
                }
            }
            // no speaker: the clock still runs at the sample rate
            None => thread::sleep(Duration::from_millis((bytes.len() as u64 / 4 * 1000) / SAMPLE_RATE as u64)),
        }
        let mut s = state.lock().unwrap();
        s.audio_written_ms = pts.saturating_add(((bytes.len() / 4) as u32 * 1000) / SAMPLE_RATE);
    }
    if let Some(mut child) = speaker.take() {
        // pw-play keeps its stream open past the end of its input
        drop(child.stdin.take());
        let _ = child.kill();
        let _ = child.wait();
    }
}
