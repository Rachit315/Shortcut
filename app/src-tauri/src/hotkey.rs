//! Hotkey normalisation, validation and conflict warnings.
//!
//! Canonical form: `Ctrl+Alt+Shift+Super+<Key>` (modifiers in that order), which is also the
//! format the global-shortcut plugin parses.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Windows,
    Mac,
    Linux,
}

impl Os {
    pub fn current() -> Self {
        if cfg!(target_os = "macos") {
            Os::Mac
        } else if cfg!(windows) {
            Os::Windows
        } else {
            Os::Linux
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct HotkeyCheck {
    /// Canonical accelerator, present when the input parsed.
    pub normalized: Option<String>,
    /// Blocking problem (cannot be saved).
    pub error: Option<String>,
    /// Non-blocking warnings (known OS/app conflicts, AltGr clashes…).
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Mods {
    ctrl: bool,
    alt: bool,
    shift: bool,
    sup: bool,
}

const NAMED_KEYS: &[&str] = &[
    "Space", "Enter", "Tab", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown",
    "Up", "Down", "Left", "Right", "Comma", "Period", "Minus", "Equal", "Slash", "Backslash",
    "Semicolon", "Quote", "Backquote", "BracketLeft", "BracketRight", "Escape",
];

fn normalize_key(token: &str) -> Option<String> {
    let t = token.trim();
    let upper = t.to_ascii_uppercase();
    // Accept KeyboardEvent.code style names from the UI recorder too.
    let stripped = upper
        .strip_prefix("KEY")
        .filter(|s| s.len() == 1)
        .or_else(|| upper.strip_prefix("DIGIT").filter(|s| s.len() == 1))
        .unwrap_or(&upper)
        .to_string();
    if stripped.len() == 1 {
        let c = stripped.chars().next().unwrap();
        if c.is_ascii_alphanumeric() {
            return Some(c.to_string());
        }
        let named = match c {
            ',' => "Comma",
            '.' => "Period",
            '-' => "Minus",
            '=' => "Equal",
            '/' => "Slash",
            '\\' => "Backslash",
            ';' => "Semicolon",
            '\'' => "Quote",
            '`' => "Backquote",
            '[' => "BracketLeft",
            ']' => "BracketRight",
            _ => return None,
        };
        return Some(named.to_string());
    }
    if let Some(n) = stripped.strip_prefix('F').and_then(|n| n.parse::<u8>().ok()) {
        if (1..=12).contains(&n) {
            return Some(format!("F{n}"));
        }
        return None;
    }
    let alias = match stripped.as_str() {
        "ARROWUP" => "Up",
        "ARROWDOWN" => "Down",
        "ARROWLEFT" => "Left",
        "ARROWRIGHT" => "Right",
        "ESC" => "Escape",
        "RETURN" => "Enter",
        "SPACEBAR" | " " => "Space",
        _ => "",
    };
    if !alias.is_empty() {
        return Some(alias.to_string());
    }
    NAMED_KEYS.iter().find(|k| k.eq_ignore_ascii_case(&stripped)).map(|k| k.to_string())
}

fn parse(input: &str) -> Result<(Mods, String), String> {
    let input = input.trim();
    if input.is_empty() {
        return Err("Press a key combination.".into());
    }
    // "Ctrl++" style is not supported; plus is written as "Equal" with Shift.
    let tokens: Vec<&str> = input.split('+').map(str::trim).collect();
    let mut mods = Mods::default();
    let mut key: Option<String> = None;
    for token in tokens {
        match token.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => mods.ctrl = true,
            "alt" | "option" | "opt" => mods.alt = true,
            "shift" => mods.shift = true,
            "super" | "cmd" | "command" | "meta" | "win" | "windows" => mods.sup = true,
            "" => return Err(format!("'{input}' is not a valid key combination.")),
            _ => {
                if key.is_some() {
                    return Err("Use one key plus modifiers, e.g. Ctrl+Alt+1.".into());
                }
                key = Some(normalize_key(token).ok_or_else(|| format!("'{token}' is not a supported key."))?);
            }
        }
    }
    let key = key.ok_or_else(|| "Add a key after the modifiers, e.g. Ctrl+Alt+1.".to_string())?;
    Ok((mods, key))
}

fn format(mods: Mods, key: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    if mods.ctrl {
        parts.push("Ctrl");
    }
    if mods.alt {
        parts.push("Alt");
    }
    if mods.shift {
        parts.push("Shift");
    }
    if mods.sup {
        parts.push("Super");
    }
    parts.push(key);
    parts.join("+")
}

/// Parse and canonicalise, or explain why the combination can't be used.
pub fn normalize(input: &str) -> Result<String, String> {
    let (mods, key) = parse(input)?;
    if !(mods.ctrl || mods.alt || mods.sup) {
        return Err(if mods.shift {
            "Shift alone would block normal typing — add Ctrl, Alt or Cmd.".into()
        } else {
            "Add at least one modifier (Ctrl, Alt or Cmd) so normal typing keeps working.".into()
        });
    }
    Ok(format(mods, &key))
}

/// Human display, e.g. `Ctrl+Alt+1` or `⌃⌥1` style names per OS.
pub fn display(accel: &str, os: Os) -> String {
    accel
        .split('+')
        .map(|p| match (p, os) {
            ("Super", Os::Mac) => "Cmd",
            ("Alt", Os::Mac) => "Option",
            ("Super", Os::Windows) => "Win",
            (p, _) => p,
        })
        .collect::<Vec<_>>()
        .join("+")
}

/// Known OS / popular-app shortcuts that a global hotkey would hijack.
fn known_conflict(accel: &str, os: Os) -> Option<&'static str> {
    let (mods, key) = parse(accel).ok()?;
    let k = key.as_str();
    let only = |c: bool, a: bool, s: bool, w: bool| mods == Mods { ctrl: c, alt: a, shift: s, sup: w };
    let is_digit = k.len() == 1 && k.chars().all(|c| c.is_ascii_digit());
    let common_edit = ["A", "C", "V", "X", "Z", "Y", "S", "F", "P", "N", "T", "W", "R", "O", "L", "Q"];

    match os {
        Os::Mac => {
            if only(false, false, false, true) && is_digit {
                return Some("Cmd+1…9 switches browser tabs");
            }
            if only(false, false, false, true) && (common_edit.contains(&k) || k == "Tab" || k == "Space" || k == "H" || k == "M") {
                return Some("This is a standard macOS shortcut (copy, paste, quit, Spotlight…)");
            }
            if only(false, false, true, true) && matches!(k, "3" | "4" | "5" | "Z") {
                return Some("Cmd+Shift+3/4/5 take screenshots; Cmd+Shift+Z is redo");
            }
            if only(true, false, false, false) && k == "Space" {
                return Some("Ctrl+Space switches input sources on macOS");
            }
            if only(false, true, false, true) && k == "Escape" {
                return Some("Cmd+Option+Esc opens Force Quit");
            }
        }
        Os::Windows | Os::Linux => {
            if only(true, false, false, false) && is_digit {
                return Some("Ctrl+1…9 switches browser and editor tabs");
            }
            if only(false, true, false, false) && is_digit {
                return Some("Alt+1…9 switches tabs in terminals and some browsers");
            }
            if only(true, false, false, false) && (common_edit.contains(&k) || k == "Tab" || k == "Space") {
                return Some("This is a standard editing/app shortcut (copy, paste, save…)");
            }
            if only(true, false, true, false) && matches!(k, "T" | "N" | "W" | "V" | "C" | "Escape" | "Tab" | "P") {
                return Some("Common app shortcut (reopen tab, new window, terminal copy/paste, command palette…)");
            }
            if only(false, true, false, false) && matches!(k, "F4" | "Tab") {
                return Some("Alt+F4 closes windows; Alt+Tab switches apps");
            }
            if only(true, true, false, false) && matches!(k, "Delete" | "T" | "Left" | "Right" | "Up" | "Down") {
                return Some("Reserved by the OS (task manager, terminal, workspace switching)");
            }
            if mods.sup {
                return Some("Win/Super shortcuts are often reserved by the OS or desktop");
            }
        }
    }
    None
}

/// AltGr = Ctrl+Alt on many European layouts, so Ctrl+Alt+<char key> can eat typed characters.
fn altgr_warning(accel: &str, os: Os) -> Option<&'static str> {
    if os == Os::Mac {
        return None;
    }
    let (mods, key) = parse(accel).ok()?;
    let printable = key.len() == 1 || matches!(key.as_str(), "Minus" | "Equal" | "BracketLeft" | "BracketRight" | "Backslash" | "Semicolon" | "Quote" | "Comma" | "Period" | "Slash" | "Backquote");
    if mods.ctrl && mods.alt && !mods.shift && !mods.sup && printable {
        return Some("On German, Polish and similar layouts Ctrl+Alt acts as AltGr and may type a character (e.g. AltGr+Q = @). If that affects you, prefer Ctrl+Shift+<key>.");
    }
    None
}

/// Full check used by the UI. `taken` returns the owner name if the canonical accel is already used.
pub fn check(input: &str, os: Os, taken: impl Fn(&str) -> Option<String>) -> HotkeyCheck {
    match normalize(input) {
        Err(e) => HotkeyCheck { normalized: None, error: Some(e), warnings: vec![] },
        Ok(accel) => {
            let mut out = HotkeyCheck { normalized: Some(accel.clone()), ..Default::default() };
            if let Some(owner) = taken(&accel) {
                out.error = Some(format!("{} is already used by {owner}.", display(&accel, os)));
            }
            if let Some(w) = known_conflict(&accel, os) {
                out.warnings.push(format!("{w} — this hotkey will override it everywhere."));
            }
            if let Some(w) = altgr_warning(&accel, os) {
                out.warnings.push(w.to_string());
            }
            out
        }
    }
}

/// First free `Ctrl+Alt+<n>` (1-9, then 0).
pub fn suggest(taken: impl Fn(&str) -> bool) -> Option<String> {
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]
        .iter()
        .map(|n| format!("Ctrl+Alt+{n}"))
        .find(|a| !taken(a))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;
    use tauri_plugin_global_shortcut::Shortcut;

    #[test]
    fn normalizes_order_aliases_and_codes() {
        assert_eq!(normalize("alt+ctrl+1").unwrap(), "Ctrl+Alt+1");
        assert_eq!(normalize("Control+Option+Digit2").unwrap(), "Ctrl+Alt+2");
        assert_eq!(normalize("cmd+shift+KeyP").unwrap(), "Shift+Super+P");
        assert_eq!(normalize("Ctrl+Shift+Space").unwrap(), "Ctrl+Shift+Space");
        assert_eq!(normalize("ctrl+alt+arrowup").unwrap(), "Ctrl+Alt+Up");
        assert_eq!(normalize("Ctrl+Alt+;").unwrap(), "Ctrl+Alt+Semicolon");
        assert_eq!(normalize("Ctrl+F5").unwrap(), "Ctrl+F5");
    }

    #[test]
    fn rejects_bad_combinations() {
        assert!(normalize("").is_err());
        assert!(normalize("A").is_err());
        assert!(normalize("Shift+A").unwrap_err().contains("Shift alone"));
        assert!(normalize("Ctrl+Alt").is_err());
        assert!(normalize("Ctrl+A+B").is_err());
        assert!(normalize("Ctrl+F13").is_err());
        assert!(normalize("Ctrl+é").is_err());
    }

    #[test]
    fn every_normalized_form_is_accepted_by_the_os_layer() {
        let mut samples: Vec<String> = ('A'..='Z').map(|c| format!("Ctrl+Alt+{c}")).collect();
        samples.extend((0..=9).map(|n| format!("Ctrl+Shift+{n}")));
        samples.extend((1..=12).map(|n| format!("Alt+F{n}")));
        samples.extend(NAMED_KEYS.iter().map(|k| format!("Ctrl+Alt+Shift+Super+{k}")));
        for s in samples {
            let n = normalize(&s).unwrap();
            Shortcut::from_str(&n).unwrap_or_else(|e| panic!("{n} rejected by plugin: {e}"));
        }
    }

    #[test]
    fn warns_about_browser_tabs_and_edit_keys() {
        let c = check("Ctrl+1", Os::Windows, |_| None);
        assert!(c.error.is_none());
        assert!(c.warnings[0].contains("tabs"));
        assert!(!check("Ctrl+C", Os::Linux, |_| None).warnings.is_empty());
        assert!(!check("Cmd+Q", Os::Mac, |_| None).warnings.is_empty());
        assert!(!check("Cmd+2", Os::Mac, |_| None).warnings.is_empty());
    }

    #[test]
    fn recommended_defaults_are_clean_except_altgr_note() {
        let c = check("Ctrl+Alt+1", Os::Mac, |_| None);
        assert!(c.warnings.is_empty());
        let c = check("Ctrl+Shift+1", Os::Windows, |_| None);
        assert!(c.warnings.is_empty());
        let c = check("Ctrl+Alt+1", Os::Windows, |_| None);
        assert_eq!(c.warnings.len(), 1);
        assert!(c.warnings[0].contains("AltGr"));
    }

    #[test]
    fn duplicates_are_blocking_errors() {
        let c = check("alt+ctrl+1", Os::Linux, |a| (a == "Ctrl+Alt+1").then(|| "'Code review'".to_string()));
        assert_eq!(c.error.unwrap(), "Ctrl+Alt+1 is already used by 'Code review'.");
    }

    #[test]
    fn display_uses_platform_names() {
        assert_eq!(display("Ctrl+Alt+Super+1", Os::Mac), "Ctrl+Option+Cmd+1");
        assert_eq!(display("Super+1", Os::Windows), "Win+1");
    }

    #[test]
    fn suggests_next_free_slot() {
        assert_eq!(suggest(|a| a == "Ctrl+Alt+1").unwrap(), "Ctrl+Alt+2");
    }
}
