//! The ClockworkPi uConsole's keyboard: an STM32 on USB (1eaf:0024, the
//! firmware is clockworkpi/uConsole Code/uconsole_keyboard) that the kernel
//! sees as four HID functions, each its own evdev node:
//!
//! | Node | What it reports |
//! |---|---|
//! | `ClockworkPI uConsole Keyboard` | the keys; the D-pad is the arrow keys (with Fn: Page Up, Page Down, Home, End) |
//! | `ClockworkPI uConsole` | a joystick: A, B, X, Y, SELECT, START as its buttons 2, 3, 1, 4, 9, 10; the D-pad on its X and Y axes in firmware before the arrow keys |
//! | `ClockworkPI uConsole Mouse` | the trackball (relative X, Y; the wheel while SELECT is held), L and R as the left and right buttons |
//! | `ClockworkPI uConsole Consumer Control` | volume and brightness keys, which omarchy-pocketd reads |
//!
//! All three are read here. The joystick's buttons press the PocketJS buttons
//! of `GAMEPAD`, and its axes the D-pad, so either firmware's D-pad works.
//! The keys become PocketJS text events
//! (a character as a commit, an editing key or a modified one as a key event
//! named as KeyboardEvent.key names it, `Control+c`), except the D-pad's
//! arrows, which are the gamepad's D-pad buttons unless Control, Alt or Meta
//! is held. The trackball and its buttons collect in `Trackball`, which the
//! shell takes each frame (`omarchyBridge.trackball()`, guest.rs) and moves
//! its own pointer with.
use pocket_drivers::{InputClasses, InputFrameBuilder, InputSource, TextEvent};
use pocket_spec::btn;
use std::{
    cell::RefCell,
    fs::{File, OpenOptions},
    io::{self, Read},
    os::unix::fs::OpenOptionsExt,
    path::Path,
    rc::Rc,
};

/// The joystick's buttons (BTN_JOYSTICK + its HID button number - 1) and the
/// PocketJS buttons they press, by label as on the RG DS Plus: A confirms.
pub const GAMEPAD: &[(u16, u32)] = &[
    (289, btn::CIRCLE),   // A (button 2)
    (290, btn::CROSS),    // B (button 3)
    (288, btn::TRIANGLE), // X (button 1)
    (291, btn::SQUARE),   // Y (button 4)
    (296, btn::SELECT),   // SELECT (button 9)
    (297, btn::START),    // START (button 10)
];

pub const KEYBOARD: &str = "ClockworkPI uConsole Keyboard";
pub const JOYSTICK: &str = "ClockworkPI uConsole";
pub const MOUSE: &str = "ClockworkPI uConsole Mouse";

/// What the trackball and its buttons did since the shell last asked.
#[derive(Default)]
pub struct Trackball {
    pub dx: i32,
    pub dy: i32,
    /// wheel detents, positive away from the user (the ball rolled up)
    pub wheel: i32,
    /// buttons down now (bit 0 L, bit 1 R, bit 2 the middle)
    pub buttons: u32,
    /// buttons that went down since the last take: a press and release
    /// inside one frame still reaches the shell
    pub pressed: u32,
}

impl Trackball {
    /// [dx, dy, wheel, buttons]; the buttons include those pressed since the last take.
    pub fn take(&mut self) -> [i32; 4] {
        let out = [self.dx, self.dy, self.wheel, (self.buttons | self.pressed) as i32];
        self.dx = 0;
        self.dy = 0;
        self.wheel = 0;
        self.pressed = 0;
        out
    }
}

pub type SharedTrackball = Rc<RefCell<Trackball>>;

/// The joystick: its buttons, and the D-pad on its X and Y axes (0 to 1023,
/// 511 at rest) or on a hat.
pub struct Joystick {
    file: File,
    events: Vec<(u16, u16, i32)>,
    held: u32,
    /// buttons that went down since the last poll: a tap inside one frame still presses
    tapped: u32,
    axes: [i32; 2],
    hat: [i32; 2],
}

impl Joystick {
    pub fn open(path: &Path) -> io::Result<Self> {
        Ok(Self { file: open(path)?, events: Vec::with_capacity(64), held: 0, tapped: 0, axes: [511, 511], hat: [0, 0] })
    }

    fn event(&mut self, kind: u16, code: u16, value: i32) {
        match (kind, code) {
            (1, _) => {
                if let Some(&(_, button)) = GAMEPAD.iter().find(|(c, _)| *c == code) {
                    if value != 0 {
                        self.held |= button;
                        self.tapped |= button;
                    } else {
                        self.held &= !button;
                    }
                }
            }
            (3, 0 | 1) => self.axes[code as usize] = value,
            (3, 16 | 17) => self.hat[(code - 16) as usize] = value.signum(),
            _ => {}
        }
    }

    fn dpad(&self) -> u32 {
        let mut out = 0;
        let [x, y] = self.axes;
        for (on, button) in [
            (x < 256 || self.hat[0] < 0, btn::LEFT),
            (x > 768 || self.hat[0] > 0, btn::RIGHT),
            (y < 256 || self.hat[1] < 0, btn::UP),
            (y > 768 || self.hat[1] > 0, btn::DOWN),
        ] {
            if on {
                out |= button;
            }
        }
        out
    }
}

impl InputSource for Joystick {
    fn classes(&self) -> InputClasses {
        InputClasses::BUTTONS
    }
    fn poll(&mut self, frame: &mut InputFrameBuilder) {
        self.events.clear();
        drain(&mut self.file, &mut self.events);
        let events = std::mem::take(&mut self.events);
        for &(kind, code, value) in &events {
            self.event(kind, code, value);
        }
        self.events = events;
        frame.buttons |= self.held | std::mem::take(&mut self.tapped) | self.dpad();
    }
}

/// input_event on aarch64: a 16-byte timeval, then type, code and value.
const EVENT: usize = 24;

fn open(path: &Path) -> io::Result<File> {
    OpenOptions::new().read(true).custom_flags(libc::O_NONBLOCK | libc::O_CLOEXEC).open(path)
}

/// Every event waiting on `file`: (type, code, value).
fn drain(file: &mut File, events: &mut Vec<(u16, u16, i32)>) {
    let mut buffer = [0u8; EVENT * 64];
    loop {
        match file.read(&mut buffer) {
            Ok(0) => return,
            Ok(n) => {
                for e in buffer[..n - n % EVENT].chunks_exact(EVENT) {
                    events.push((
                        u16::from_ne_bytes([e[16], e[17]]),
                        u16::from_ne_bytes([e[18], e[19]]),
                        i32::from_ne_bytes([e[20], e[21], e[22], e[23]]),
                    ));
                }
                if n < buffer.len() {
                    return;
                }
            }
            Err(_) => return,
        }
    }
}

/// The trackball's node: deltas, wheel and buttons into the shared state.
pub struct Mouse {
    file: File,
    state: SharedTrackball,
    events: Vec<(u16, u16, i32)>,
}

impl Mouse {
    pub fn open(path: &Path, state: SharedTrackball) -> io::Result<Self> {
        Ok(Self { file: open(path)?, state, events: Vec::with_capacity(64) })
    }
}

impl InputSource for Mouse {
    /// The profile's touch: an applet's contacts are the pointer's clicks,
    /// which the shell places on its surface (stage/pointer.tsx).
    fn classes(&self) -> InputClasses {
        InputClasses::from_bits(InputClasses::CONTACT.bits() | InputClasses::POINTER.bits())
    }
    fn poll(&mut self, _: &mut InputFrameBuilder) {
        self.events.clear();
        drain(&mut self.file, &mut self.events);
        let mut state = self.state.borrow_mut();
        for &(kind, code, value) in &self.events {
            match (kind, code) {
                (2, 0) => state.dx += value,
                (2, 1) => state.dy += value,
                (2, 8) => state.wheel += value,
                (1, 272..=274) => {
                    let bit = 1 << (code - 272);
                    if value != 0 {
                        state.buttons |= bit;
                        state.pressed |= bit;
                    } else {
                        state.buttons &= !bit;
                    }
                }
                _ => {}
            }
        }
    }
}

const SHIFT: u8 = 1;
const CONTROL: u8 = 2;
const ALT: u8 = 4;
const META: u8 = 8;

/// The modifier a key code is, if it is one.
fn modifier(code: u16) -> Option<u8> {
    match code {
        42 | 54 => Some(SHIFT),
        29 | 97 => Some(CONTROL),
        56 | 100 => Some(ALT),
        125 | 126 => Some(META),
        _ => None,
    }
}

/// A key that types a character on a US layout: (plain, with Shift).
fn character(code: u16) -> Option<(char, char)> {
    const ROW1: &[u8] = b"1234567890-=";
    const ROW1_SHIFT: &[u8] = b"!@#$%^&*()_+";
    Some(match code {
        2..=13 => (ROW1[code as usize - 2] as char, ROW1_SHIFT[code as usize - 2] as char),
        16..=25 => {
            let c = b"qwertyuiop"[code as usize - 16] as char;
            (c, c.to_ascii_uppercase())
        }
        26 => ('[', '{'),
        27 => (']', '}'),
        30..=38 => {
            let c = b"asdfghjkl"[code as usize - 30] as char;
            (c, c.to_ascii_uppercase())
        }
        39 => (';', ':'),
        40 => ('\'', '"'),
        41 => ('`', '~'),
        43 => ('\\', '|'),
        44..=50 => {
            let c = b"zxcvbnm"[code as usize - 44] as char;
            (c, c.to_ascii_uppercase())
        }
        51 => (',', '<'),
        52 => ('.', '>'),
        53 => ('/', '?'),
        57 => (' ', ' '),
        _ => return None,
    })
}

/// An editing or function key, named as KeyboardEvent.key names it.
fn named(code: u16) -> Option<&'static str> {
    Some(match code {
        1 => "Escape",
        14 => "Backspace",
        15 => "Tab",
        28 | 96 => "Enter",
        102 => "Home",
        103 => "ArrowUp",
        104 => "PageUp",
        105 => "ArrowLeft",
        106 => "ArrowRight",
        107 => "End",
        108 => "ArrowDown",
        109 => "PageDown",
        110 => "Insert",
        111 => "Delete",
        59 => "F1",
        60 => "F2",
        61 => "F3",
        62 => "F4",
        63 => "F5",
        64 => "F6",
        65 => "F7",
        66 => "F8",
        67 => "F9",
        68 => "F10",
        87 => "F11",
        88 => "F12",
        99 => "PrintScreen",
        119 => "Pause",
        _ => return None,
    })
}

/// The D-pad's arrow keys and the buttons they press.
const ARROWS: [(u16, u32); 4] = [(103, btn::UP), (108, btn::DOWN), (105, btn::LEFT), (106, btn::RIGHT)];

fn prefix(mods: u8, with_shift: bool) -> String {
    let mut out = String::new();
    for (bit, name) in [(CONTROL, "Control+"), (ALT, "Alt+"), (META, "Meta+"), (SHIFT, "Shift+")] {
        if mods & bit != 0 && (bit != SHIFT || with_shift) {
            out.push_str(name);
        }
    }
    out
}

/// The keyboard's node as text events, and the D-pad as buttons.
pub struct Keyboard {
    file: File,
    events: Vec<(u16, u16, i32)>,
    mods: u8,
    caps: bool,
    /// the D-pad's arrows held as buttons
    arrows: u32,
    /// arrows that went down since the last poll: a tap inside one frame still presses
    tapped: u32,
}

impl Keyboard {
    pub fn open(path: &Path) -> io::Result<Self> {
        Ok(Self { file: open(path)?, events: Vec::with_capacity(64), mods: 0, caps: false, arrows: 0, tapped: 0 })
    }

    /// One key's press (value 1), repeat (2) or release (0).
    fn key(&mut self, code: u16, value: i32, frame: &mut InputFrameBuilder) {
        let pressed = value != 0;
        let repeat = value == 2;
        if let Some(bit) = modifier(code) {
            if repeat {
                return;
            }
            if pressed {
                self.mods |= bit;
            } else {
                self.mods &= !bit;
            }
            let name = match bit {
                SHIFT => "Shift",
                CONTROL => "Control",
                ALT => "Alt",
                _ => "Meta",
            };
            frame.text.push(TextEvent::Key { key: name.into(), pressed, repeat: false });
            return;
        }
        if code == 58 {
            if value == 1 {
                self.caps = !self.caps;
            }
            return;
        }
        // the D-pad: buttons, unless a modifier other than Shift makes it a key
        if let Some(&(_, button)) = ARROWS.iter().find(|(c, _)| *c == code) {
            let as_key = self.mods & (CONTROL | ALT | META) != 0;
            if !pressed {
                if self.arrows & button != 0 {
                    self.arrows &= !button;
                    return;
                }
            } else if !as_key {
                self.arrows |= button;
                self.tapped |= button;
                return;
            } else if self.arrows & button != 0 {
                return;
            }
        }
        if let Some(name) = named(code) {
            let key = format!("{}{name}", prefix(self.mods, true));
            frame.text.push(TextEvent::Key { key, pressed, repeat });
            return;
        }
        let Some((plain, shifted)) = character(code) else { return };
        let shift = self.mods & SHIFT != 0;
        let upper = if plain.is_ascii_alphabetic() { shift != self.caps } else { shift };
        let ch = if upper { shifted } else { plain };
        if self.mods & (CONTROL | ALT | META) != 0 {
            // a chord names the key as typed: Control+c, Control+C with Shift
            let key = format!("{}{ch}", prefix(self.mods, false));
            frame.text.push(TextEvent::Key { key, pressed, repeat });
        } else if pressed {
            frame.text.push(TextEvent::Commit(ch.to_string()));
        }
    }
}

impl InputSource for Keyboard {
    fn classes(&self) -> InputClasses {
        InputClasses::from_bits(InputClasses::BUTTONS.bits() | InputClasses::TEXT.bits())
    }
    fn poll(&mut self, frame: &mut InputFrameBuilder) {
        self.events.clear();
        drain(&mut self.file, &mut self.events);
        let events = std::mem::take(&mut self.events);
        for &(kind, code, value) in &events {
            if kind == 1 {
                self.key(code, value, frame);
            }
        }
        self.events = events;
        frame.buttons |= self.arrows | std::mem::take(&mut self.tapped);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keyboard() -> Keyboard {
        Keyboard { file: File::open("/dev/null").unwrap(), events: Vec::new(), mods: 0, caps: false, arrows: 0, tapped: 0 }
    }

    fn texts(frame: &InputFrameBuilder) -> Vec<String> {
        frame
            .text
            .iter()
            .map(|e| match e {
                TextEvent::Commit(t) => format!("commit {t}"),
                TextEvent::Key { key, pressed, .. } => format!("{} {key}", if *pressed { "down" } else { "up" }),
                _ => String::new(),
            })
            .collect()
    }

    #[test]
    fn characters_commit_and_chords_name_the_key() {
        let mut k = keyboard();
        let mut frame = InputFrameBuilder::new();
        k.key(35, 1, &mut frame); // h
        k.key(35, 0, &mut frame);
        k.key(42, 1, &mut frame); // shift
        k.key(3, 1, &mut frame); // 2 -> @
        k.key(42, 0, &mut frame);
        k.key(29, 1, &mut frame); // control
        k.key(46, 1, &mut frame); // c
        k.key(29, 0, &mut frame);
        k.key(14, 2, &mut frame); // backspace repeat
        assert_eq!(
            texts(&frame),
            ["commit h", "down Shift", "commit @", "up Shift", "down Control", "down Control+c", "up Control", "down Backspace"]
        );
    }

    #[test]
    fn the_dpad_is_buttons_until_control() {
        let mut k = keyboard();
        let mut frame = InputFrameBuilder::new();
        k.key(105, 1, &mut frame);
        assert_eq!(k.arrows, btn::LEFT);
        assert!(frame.text.is_empty());
        k.key(105, 0, &mut frame);
        assert_eq!(k.arrows, 0);
        k.key(29, 1, &mut frame);
        k.key(105, 1, &mut frame);
        assert_eq!(k.arrows, 0);
        assert_eq!(texts(&frame).last().unwrap(), "down Control+ArrowLeft");
    }

    #[test]
    fn caps_lock_raises_letters_only() {
        let mut k = keyboard();
        let mut frame = InputFrameBuilder::new();
        k.key(58, 1, &mut frame);
        k.key(30, 1, &mut frame); // a
        k.key(2, 1, &mut frame); // 1
        assert_eq!(texts(&frame), ["commit A", "commit 1"]);
    }

    #[test]
    fn the_joystick_dpad_works_on_either_firmware() {
        let mut j = Joystick { file: File::open("/dev/null").unwrap(), events: Vec::new(), held: 0, tapped: 0, axes: [511, 511], hat: [0, 0] };
        j.event(1, 289, 1);
        assert_eq!(j.held, btn::CIRCLE);
        j.event(3, 0, 0);
        assert_eq!(j.dpad(), btn::LEFT);
        j.event(3, 0, 511);
        j.event(3, 1, 1023);
        assert_eq!(j.dpad(), btn::DOWN);
    }

    #[test]
    fn a_click_inside_one_frame_still_reaches_the_shell() {
        let mut t = Trackball::default();
        t.buttons |= 1;
        t.pressed |= 1;
        t.buttons &= !1;
        assert_eq!(t.take()[3], 1);
        assert_eq!(t.take()[3], 0);
    }
}
