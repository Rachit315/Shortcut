//! Text triggers: validation and the rolling-buffer matcher.
//! The OS keyboard listeners live in `listener.rs`; this module is pure and unit-tested.

use serde::Serialize;

pub const BUFFER_CHARS: usize = 64;
pub const MIN_TRIGGER_CHARS: usize = 2;
pub const MAX_TRIGGER_CHARS: usize = 32;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct TriggerCheck {
    pub normalized: Option<String>,
    pub error: Option<String>,
    pub warnings: Vec<String>,
}

pub fn validate(input: &str) -> Result<String, String> {
    let t = input.trim();
    let n = t.chars().count();
    if n < MIN_TRIGGER_CHARS {
        return Err(format!("Use at least {MIN_TRIGGER_CHARS} characters, e.g. ;push"));
    }
    if n > MAX_TRIGGER_CHARS {
        return Err(format!("Keep triggers to {MAX_TRIGGER_CHARS} characters or fewer."));
    }
    if t.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("Triggers can't contain spaces or line breaks.".into());
    }
    Ok(t.to_string())
}

/// `existing` = (trigger, owner title) for every other prompt.
pub fn check(input: &str, existing: &[(String, String)]) -> TriggerCheck {
    let t = match validate(input) {
        Ok(t) => t,
        Err(e) => return TriggerCheck { normalized: None, error: Some(e), warnings: vec![] },
    };
    let mut out = TriggerCheck { normalized: Some(t.clone()), ..Default::default() };
    for (other, owner) in existing {
        if *other == t {
            out.error = Some(format!("{t} is already used by '{owner}'."));
        } else if other.ends_with(&t) {
            out.warnings.push(format!("Typing {other} ('{owner}') would fire {t} first, so '{owner}' will never expand."));
        } else if t.ends_with(other.as_str()) {
            out.warnings.push(format!("{other} ('{owner}') fires before you finish typing {t}."));
        }
    }
    if t.chars().next().is_some_and(|c| c.is_alphanumeric()) {
        out.warnings.push("Triggers that start with a letter can fire while typing normal words. Start with a symbol like ; or /.".into());
    }
    out
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyInput {
    Char(char),
    Backspace,
    /// Navigation, mouse click, shortcut chord… — the typed context is no longer contiguous.
    Reset,
}

#[derive(Debug, Default)]
pub struct Matcher {
    buf: Vec<char>,
}

impl Matcher {
    /// Feed one input; returns the index into `triggers` of the (longest) trigger that just completed.
    pub fn feed(&mut self, input: KeyInput, triggers: &[String]) -> Option<usize> {
        match input {
            KeyInput::Reset => {
                self.buf.clear();
                None
            }
            KeyInput::Backspace => {
                self.buf.pop();
                None
            }
            KeyInput::Char(c) => {
                if c.is_control() {
                    self.buf.clear();
                    return None;
                }
                self.buf.push(c);
                if self.buf.len() > BUFFER_CHARS {
                    let excess = self.buf.len() - BUFFER_CHARS;
                    self.buf.drain(..excess);
                }
                let typed: String = self.buf.iter().collect();
                let hit = triggers
                    .iter()
                    .enumerate()
                    .filter(|(_, t)| !t.is_empty() && typed.ends_with(t.as_str()))
                    .max_by_key(|(_, t)| t.chars().count())
                    .map(|(i, _)| i);
                if hit.is_some() {
                    self.buf.clear();
                }
                hit
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed_str(m: &mut Matcher, s: &str, triggers: &[String]) -> Vec<usize> {
        s.chars().filter_map(|c| m.feed(KeyInput::Char(c), triggers)).collect()
    }

    #[test]
    fn validation() {
        assert_eq!(validate(" ;push ").unwrap(), ";push");
        assert!(validate(";").is_err());
        assert!(validate("; p").is_err());
        assert!(validate(&";".repeat(33)).is_err());
    }

    #[test]
    fn check_finds_duplicates_and_suffix_clashes() {
        let existing = vec![(";push".to_string(), "Push".to_string())];
        assert!(check(";push", &existing).error.unwrap().contains("Push"));
        let c = check("sh", &existing);
        assert!(c.error.is_none());
        assert_eq!(c.warnings.len(), 2); // suffix clash + starts with letter
        assert!(check(";pr", &existing).warnings.is_empty());
    }

    #[test]
    fn matches_trigger_at_end_of_typing() {
        let triggers = vec![";push".to_string(), ";rev".to_string()];
        let mut m = Matcher::default();
        assert_eq!(feed_str(&mut m, "hello ;pus", &triggers), Vec::<usize>::new());
        assert_eq!(m.feed(KeyInput::Char('h'), &triggers), Some(0));
        assert_eq!(feed_str(&mut m, "x;rev", &triggers), vec![1]);
    }

    #[test]
    fn backspace_edits_buffer() {
        let triggers = vec![";push".to_string()];
        let mut m = Matcher::default();
        feed_str(&mut m, ";pux", &triggers);
        m.feed(KeyInput::Backspace, &triggers);
        assert_eq!(feed_str(&mut m, "sh", &triggers), vec![0]);
    }

    #[test]
    fn reset_breaks_sequences() {
        let triggers = vec![";push".to_string()];
        let mut m = Matcher::default();
        feed_str(&mut m, ";pu", &triggers);
        m.feed(KeyInput::Reset, &triggers);
        assert!(feed_str(&mut m, "sh", &triggers).is_empty());
    }

    #[test]
    fn longest_match_wins() {
        let triggers = vec!["sh".to_string(), ";push".to_string()];
        let mut m = Matcher::default();
        // "sh" and ";push" complete on the same keystroke; the longer one wins.
        assert_eq!(feed_str(&mut m, ";push", &triggers), vec![1]);
        let triggers = vec![";pu".to_string(), ";push".to_string()];
        let mut m = Matcher::default();
        // A shorter trigger that completes earlier fires first (the UI warns about this).
        assert_eq!(feed_str(&mut m, ";push", &triggers), vec![0]);
        let triggers = vec!["h".to_string(), ";push".to_string()];
        let mut m = Matcher::default();
        assert_eq!(feed_str(&mut m, ";pus", &triggers), Vec::<usize>::new());
        assert_eq!(m.feed(KeyInput::Char('h'), &triggers), Some(1));
    }

    #[test]
    fn unicode_triggers() {
        let triggers = vec!["→ok".to_string()];
        let mut m = Matcher::default();
        assert_eq!(feed_str(&mut m, "ab→ok", &triggers), vec![0]);
    }

    #[test]
    fn buffer_is_bounded() {
        let triggers = vec![";x".to_string()];
        let mut m = Matcher::default();
        feed_str(&mut m, &"a".repeat(10_000), &triggers);
        assert!(m.buf.len() <= BUFFER_CHARS);
        assert_eq!(feed_str(&mut m, ";x", &triggers), vec![0]);
    }
}
