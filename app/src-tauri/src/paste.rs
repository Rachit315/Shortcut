//! Paste pipeline: render → (erase trigger) → clipboard + paste keystroke (or type) → caret → restore.
//!
//! Everything runs on one dedicated worker thread that owns the clipboard handle and the input
//! simulator, so pastes never overlap and X11 clipboard ownership lives as long as the app.

use crate::models::{PasteKeystroke, PasteMethod, Settings};
use crate::template::{self, Parsed};
use enigo::{Direction, Enigo, Key, Keyboard};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

/// Keyboard listeners ignore events until this unix-ms timestamp (our own injected keys).
pub static SUPPRESS_UNTIL: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn is_suppressed() -> bool {
    now_ms() < SUPPRESS_UNTIL.load(Ordering::SeqCst)
}

fn suppress_begin() {
    SUPPRESS_UNTIL.store(u64::MAX, Ordering::SeqCst);
}

fn suppress_end() {
    // Grace period: some platforms deliver synthetic events to listeners slightly late.
    SUPPRESS_UNTIL.store(now_ms() + 250, Ordering::SeqCst);
}

/// Above this, "type it out" would take too long; always use the clipboard.
pub const MAX_TYPED_CHARS: usize = 10_000;
/// Moving the caret further than this is slow and rarely what the user wants.
pub const MAX_CURSOR_BACK: usize = 5_000;

pub struct PasteRequest {
    pub parsed: Parsed,
    pub values: HashMap<String, String>,
    /// Characters to delete first (the typed text trigger).
    pub erase: usize,
    /// Synthetically release held modifiers (hotkey still physically down).
    pub release_modifiers: bool,
    /// Wait before injecting (lets focus settle after the palette hides).
    pub delay_before_ms: u64,
    pub copy_only: bool,
    pub settings: Settings,
}

type Job = Box<dyn FnOnce(&mut Worker) + Send>;

pub struct PasteService {
    tx: Sender<Job>,
    busy: Arc<AtomicBool>,
}

pub struct Worker {
    enigo: Option<Enigo>,
    clipboard: Option<arboard::Clipboard>,
}

impl PasteService {
    pub fn start() -> Self {
        let (tx, rx) = channel::<Job>();
        thread::Builder::new()
            .name("clazy-paste".into())
            .spawn(move || {
                let mut worker = Worker { enigo: None, clipboard: None };
                while let Ok(job) = rx.recv() {
                    job(&mut worker);
                }
            })
            .expect("failed to spawn paste worker");
        Self { tx, busy: Arc::new(AtomicBool::new(false)) }
    }

    pub fn is_busy(&self) -> bool {
        self.busy.load(Ordering::SeqCst)
    }

    /// Queue a paste. Returns false (and does nothing) if one is already in flight.
    pub fn submit(&self, req: PasteRequest, done: impl FnOnce(Result<(), String>) + Send + 'static) -> bool {
        if self.busy.swap(true, Ordering::SeqCst) {
            return false;
        }
        let busy = self.busy.clone();
        let sent = self.tx.send(Box::new(move |w: &mut Worker| {
            let result = w.execute(req);
            busy.store(false, Ordering::SeqCst);
            done(result);
        }));
        if sent.is_err() {
            self.busy.store(false, Ordering::SeqCst);
            return false;
        }
        true
    }

    /// Delete `n` characters before the caret (used before asking for fill-in values).
    /// Blocks until done so nothing else (like the palette taking focus) can race it.
    pub fn erase(&self, n: usize) {
        if n == 0 {
            return;
        }
        let (done_tx, done_rx) = channel::<()>();
        let _ = self.tx.send(Box::new(move |w: &mut Worker| {
            if let Ok(e) = w.enigo() {
                suppress_begin();
                thread::sleep(Duration::from_millis(20));
                for _ in 0..n {
                    let _ = e.key(Key::Backspace, Direction::Click);
                }
                // Let the target app process the deletions before focus moves.
                thread::sleep(Duration::from_millis(60));
                suppress_end();
            }
            let _ = done_tx.send(());
        }));
        let _ = done_rx.recv_timeout(Duration::from_secs(2));
    }
}

impl Worker {
    fn enigo(&mut self) -> Result<&mut Enigo, String> {
        if self.enigo.is_none() {
            let e = Enigo::new(&enigo::Settings::default()).map_err(|e| {
                format!("Can't simulate keystrokes ({e}). On macOS, allow Clazy under System Settings → Privacy & Security → Accessibility.")
            })?;
            self.enigo = Some(e);
        }
        Ok(self.enigo.as_mut().unwrap())
    }

    fn clipboard(&mut self) -> Result<&mut arboard::Clipboard, String> {
        if self.clipboard.is_none() {
            self.clipboard = Some(arboard::Clipboard::new().map_err(|e| format!("Clipboard unavailable: {e}"))?);
        }
        Ok(self.clipboard.as_mut().unwrap())
    }

    fn execute(&mut self, req: PasteRequest) -> Result<(), String> {
        let previous = self.clipboard()?.get_text().ok();
        let ctx = template::Context {
            clipboard: previous.clone().unwrap_or_default(),
            now: chrono::Local::now().naive_local(),
        };
        let rendered = template::render(&req.parsed, &ctx, &req.values);

        if req.copy_only {
            return self.clipboard()?.set_text(rendered.text).map_err(|e| format!("Couldn't copy: {e}"));
        }
        if req.delay_before_ms > 0 {
            thread::sleep(Duration::from_millis(req.delay_before_ms));
        }

        let use_typing = req.settings.paste_method == PasteMethod::Type
            && rendered.text.chars().count() <= MAX_TYPED_CHARS;
        if !use_typing {
            self.clipboard()?.set_text(rendered.text.clone()).map_err(|e| format!("Couldn't write the clipboard: {e}"))?;
        }

        suppress_begin();
        let result = self.inject(&req, &rendered.text, rendered.cursor_back, use_typing);
        suppress_end();
        result?;

        if !use_typing && req.settings.restore_clipboard {
            // The target app reads the clipboard asynchronously after the paste keystroke.
            thread::sleep(Duration::from_millis(req.settings.restore_delay_ms));
            if let Some(prev) = previous {
                let _ = self.clipboard()?.set_text(prev);
            }
        }
        Ok(())
    }

    fn inject(&mut self, req: &PasteRequest, text: &str, cursor_back: usize, use_typing: bool) -> Result<(), String> {
        let keystroke = req.settings.paste_keystroke;
        let e = self.enigo()?;
        let err = |x: enigo::InputError| format!("Keystroke failed: {x}");
        if req.release_modifiers {
            for m in [Key::Control, Key::Shift, Key::Alt, Key::Meta] {
                let _ = e.key(m, Direction::Release);
            }
            thread::sleep(Duration::from_millis(25));
        }
        if req.erase > 0 {
            thread::sleep(Duration::from_millis(15));
            for _ in 0..req.erase {
                e.key(Key::Backspace, Direction::Click).map_err(err)?;
            }
            thread::sleep(Duration::from_millis(15));
        }
        if use_typing {
            type_text(e, text).map_err(err)?;
        } else {
            thread::sleep(Duration::from_millis(20));
            send_paste_keystroke(e, keystroke).map_err(err)?;
        }
        if cursor_back > 0 {
            // Let the target app finish inserting before moving the caret.
            thread::sleep(Duration::from_millis(if use_typing { 30 } else { 120 }));
            for _ in 0..cursor_back.min(MAX_CURSOR_BACK) {
                e.key(Key::LeftArrow, Direction::Click).map_err(err)?;
            }
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn send_paste_keystroke(e: &mut Enigo, _ks: PasteKeystroke) -> enigo::InputResult<()> {
    // kVK_ANSI_V = 9. A raw keycode avoids layout lookups that must run on the main thread.
    e.key(Key::Meta, Direction::Press)?;
    let r = e.key(Key::Other(9), Direction::Click);
    e.key(Key::Meta, Direction::Release)?;
    r
}

#[cfg(not(target_os = "macos"))]
fn send_paste_keystroke(e: &mut Enigo, ks: PasteKeystroke) -> enigo::InputResult<()> {
    #[cfg(windows)]
    let v = Key::V;
    #[cfg(not(windows))]
    let v = Key::Unicode('v');
    let (mods, key): (Vec<Key>, Key) = match ks {
        PasteKeystroke::CtrlV => (vec![Key::Control], v),
        PasteKeystroke::CtrlShiftV => (vec![Key::Control, Key::Shift], v),
        PasteKeystroke::ShiftInsert => (vec![Key::Shift], Key::Insert),
    };
    for m in &mods {
        e.key(*m, Direction::Press)?;
    }
    let r = e.key(key, Direction::Click);
    for m in mods.iter().rev() {
        e.key(*m, Direction::Release)?;
    }
    r
}

/// Type text; newlines become Shift+Enter so chat boxes don't send the message early.
fn type_text(e: &mut Enigo, text: &str) -> enigo::InputResult<()> {
    for (i, line) in text.split('\n').enumerate() {
        if i > 0 {
            e.key(Key::Shift, Direction::Press)?;
            let r = e.key(Key::Return, Direction::Click);
            e.key(Key::Shift, Direction::Release)?;
            r?;
        }
        let line = line.trim_end_matches('\r');
        if !line.is_empty() {
            e.text(line)?;
        }
    }
    Ok(())
}
