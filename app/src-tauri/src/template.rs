//! Prompt template language.
//!
//! * `{{clipboard}}`, `{{date}}`, `{{time}}`, `{{datetime}}` — built-ins resolved at paste time
//! * `{{cursor}}` — where the caret ends up after pasting (first marker wins)
//! * `{{name}}`, `{{name=default}}`, `{{name:a|b|c}}` — fill-in variables asked for before pasting
//!
//! Anything malformed is kept as literal text so a paste never fails because of syntax.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Builtin {
    Clipboard,
    Date,
    Time,
    Datetime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Segment {
    Text(String),
    Builtin(Builtin),
    Cursor,
    Var(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VarKind {
    Text,
    Choice,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VarSpec {
    pub name: String,
    pub kind: VarKind,
    pub default: Option<String>,
    pub options: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Parsed {
    pub segments: Vec<Segment>,
    /// Unique fill-in variables in order of first appearance.
    pub vars: Vec<VarSpec>,
    pub uses_clipboard: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rendered {
    pub text: String,
    /// Number of characters after the `{{cursor}}` marker (0 when there is none).
    pub cursor_back: usize,
}

pub struct Context {
    pub clipboard: String,
    pub now: chrono::NaiveDateTime,
}

const MAX_NAME_CHARS: usize = 40;

fn valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_alphanumeric() || c == '_' => {}
        _ => return false,
    }
    name.chars().count() <= MAX_NAME_CHARS
        && name.chars().all(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | ' ' | '.'))
}

fn builtin(name: &str) -> Option<Segment> {
    match name.to_ascii_lowercase().as_str() {
        "clipboard" => Some(Segment::Builtin(Builtin::Clipboard)),
        "date" => Some(Segment::Builtin(Builtin::Date)),
        "time" => Some(Segment::Builtin(Builtin::Time)),
        "datetime" => Some(Segment::Builtin(Builtin::Datetime)),
        "cursor" => Some(Segment::Cursor),
        _ => None,
    }
}

/// Interpret the inside of `{{ ... }}`. `None` means "not a placeholder, keep literally".
fn parse_placeholder(inner: &str) -> Option<(Segment, Option<VarSpec>)> {
    let inner = inner.trim();
    if inner.is_empty() || inner.contains('\n') {
        return None;
    }
    let eq = inner.find('=');
    let colon = inner.find(':');
    let (name, default, options) = match (eq, colon) {
        (Some(e), Some(c)) if c < e => {
            let (n, rest) = inner.split_at(c);
            (n.trim(), None, Some(&rest[1..]))
        }
        (Some(e), _) => {
            let (n, rest) = inner.split_at(e);
            (n.trim(), Some(rest[1..].to_string()), None)
        }
        (None, Some(c)) => {
            let (n, rest) = inner.split_at(c);
            (n.trim(), None, Some(&rest[1..]))
        }
        (None, None) => (inner, None, None),
    };
    if !valid_name(name) {
        return None;
    }
    if default.is_none() && options.is_none() {
        if let Some(seg) = builtin(name) {
            return Some((seg, None));
        }
    } else if builtin(name).is_some() {
        // `{{date=x}}` is ambiguous; keep it literal rather than guess.
        return None;
    }
    let spec = match options {
        Some(opts) => {
            let options: Vec<String> = opts
                .split('|')
                .map(|o| o.trim().to_string())
                .filter(|o| !o.is_empty())
                .collect();
            if options.is_empty() {
                return None;
            }
            VarSpec { name: name.to_string(), kind: VarKind::Choice, default: Some(options[0].clone()), options }
        }
        None => VarSpec { name: name.to_string(), kind: VarKind::Text, default, options: vec![] },
    };
    Some((Segment::Var(name.to_string()), Some(spec)))
}

pub fn parse(body: &str) -> Parsed {
    let mut segments: Vec<Segment> = Vec::new();
    let mut vars: Vec<VarSpec> = Vec::new();
    let mut uses_clipboard = false;
    let mut text = String::new();
    let mut rest = body;

    while let Some(start) = rest.find("{{") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else { break };
        let inner = &after[..end];
        // A nested "{{" means the first one was literal; resume scanning at the inner one.
        if let Some(nested) = inner.find("{{") {
            text.push_str(&rest[..start + 2 + nested]);
            rest = &rest[start + 2 + nested..];
            continue;
        }
        match parse_placeholder(inner) {
            Some((seg, spec)) => {
                text.push_str(&rest[..start]);
                if !text.is_empty() {
                    segments.push(Segment::Text(std::mem::take(&mut text)));
                }
                if seg == Segment::Builtin(Builtin::Clipboard) {
                    uses_clipboard = true;
                }
                if let Some(spec) = spec {
                    if !vars.iter().any(|v| v.name == spec.name) {
                        vars.push(spec);
                    }
                }
                segments.push(seg);
            }
            None => text.push_str(&rest[..start + 2 + end + 2]),
        }
        rest = &after[end + 2..];
    }
    text.push_str(rest);
    if !text.is_empty() {
        segments.push(Segment::Text(text));
    }
    Parsed { segments, vars, uses_clipboard }
}

pub fn render(parsed: &Parsed, ctx: &Context, values: &HashMap<String, String>) -> Rendered {
    let mut out = String::new();
    let mut cursor_at: Option<usize> = None; // char index
    for seg in &parsed.segments {
        match seg {
            Segment::Text(t) => out.push_str(t),
            Segment::Builtin(Builtin::Clipboard) => out.push_str(&ctx.clipboard),
            Segment::Builtin(Builtin::Date) => out.push_str(&ctx.now.format("%Y-%m-%d").to_string()),
            Segment::Builtin(Builtin::Time) => out.push_str(&ctx.now.format("%H:%M").to_string()),
            Segment::Builtin(Builtin::Datetime) => {
                out.push_str(&ctx.now.format("%Y-%m-%d %H:%M").to_string())
            }
            Segment::Cursor => {
                if cursor_at.is_none() {
                    cursor_at = Some(out.chars().count());
                }
            }
            Segment::Var(name) => {
                let value = values.get(name).cloned().or_else(|| {
                    parsed.vars.iter().find(|v| &v.name == name).and_then(|v| v.default.clone())
                });
                out.push_str(&value.unwrap_or_default());
            }
        }
    }
    let total = out.chars().count();
    Rendered { cursor_back: cursor_at.map(|c| total - c).unwrap_or(0), text: out }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> Context {
        Context {
            clipboard: "fn main() {}".into(),
            now: chrono::NaiveDate::from_ymd_opt(2026, 9, 26).unwrap().and_hms_opt(9, 5, 0).unwrap(),
        }
    }

    fn render_str(body: &str, values: &[(&str, &str)]) -> Rendered {
        let values: HashMap<String, String> =
            values.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        render(&parse(body), &ctx(), &values)
    }

    #[test]
    fn plain_text_is_unchanged() {
        let r = render_str("Review this code.\nBe strict.", &[]);
        assert_eq!(r.text, "Review this code.\nBe strict.");
        assert_eq!(r.cursor_back, 0);
    }

    #[test]
    fn builtins_are_resolved() {
        let r = render_str("{{date}} {{time}} | {{datetime}} | {{ CLIPBOARD }}", &[]);
        assert_eq!(r.text, "2026-09-26 09:05 | 2026-09-26 09:05 | fn main() {}");
    }

    #[test]
    fn cursor_marker_sets_cursor_back() {
        let r = render_str("Explain {{cursor}} simply.", &[]);
        assert_eq!(r.text, "Explain  simply.");
        assert_eq!(r.cursor_back, " simply.".chars().count());
    }

    #[test]
    fn only_first_cursor_counts_and_others_are_removed() {
        let r = render_str("a{{cursor}}b{{cursor}}c", &[]);
        assert_eq!(r.text, "abc");
        assert_eq!(r.cursor_back, 2);
    }

    #[test]
    fn cursor_back_counts_unicode_chars() {
        let r = render_str("{{cursor}}héllo 👋", &[]);
        assert_eq!(r.cursor_back, 7);
    }

    #[test]
    fn fill_in_variables_are_collected_once_in_order() {
        let p = parse("Write {{language=Python}} tests for {{subject}} in {{language}} ({{tone:formal|casual}}).");
        let names: Vec<_> = p.vars.iter().map(|v| v.name.as_str()).collect();
        assert_eq!(names, vec!["language", "subject", "tone"]);
        assert_eq!(p.vars[0].default.as_deref(), Some("Python"));
        assert_eq!(p.vars[2].kind, VarKind::Choice);
        assert_eq!(p.vars[2].options, vec!["formal", "casual"]);
    }

    #[test]
    fn values_and_defaults_are_applied() {
        let r = render_str("{{language=Python}} / {{subject}} / {{tone:formal|casual}}", &[("subject", "auth")]);
        assert_eq!(r.text, "Python / auth / formal");
        let r = render_str("{{language=Python}}", &[("language", "Rust")]);
        assert_eq!(r.text, "Rust");
    }

    #[test]
    fn missing_value_without_default_renders_empty() {
        assert_eq!(render_str("[{{subject}}]", &[]).text, "[]");
    }

    #[test]
    fn malformed_placeholders_stay_literal() {
        for body in [
            "{{}}",
            "{{ }}",
            "open {{ only",
            "{{!bad}}",
            "{{a\nb}}",
            "{{tone:}}",
            "{{date=today}}",
            "const x = {{{a}}}",
        ] {
            let p = parse(body);
            let r = render(&p, &ctx(), &HashMap::new());
            assert_eq!(r.text, body, "body: {body}");
            assert!(p.vars.is_empty(), "body: {body}");
        }
    }

    #[test]
    fn nested_open_braces_resume_scanning() {
        let r = render_str("{{ a {{subject}}", &[("subject", "X")]);
        assert_eq!(r.text, "{{ a X");
    }

    #[test]
    fn detects_clipboard_usage() {
        assert!(parse("Fix this:\n{{clipboard}}").uses_clipboard);
        assert!(!parse("Fix this").uses_clipboard);
    }

    #[test]
    fn long_bodies_render_intact() {
        let body = "x".repeat(100_000);
        assert_eq!(render_str(&body, &[]).text.len(), 100_000);
    }
}
