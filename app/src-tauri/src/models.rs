use serde::{Deserialize, Serialize};

pub const MAX_TITLE_CHARS: usize = 200;
pub const MAX_BODY_CHARS: usize = 100_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Prompt {
    pub id: String,
    pub title: String,
    pub body: String,
    pub folder_id: Option<String>,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub hotkey: Option<String>,
    pub trigger: Option<String>,
    pub use_count: i64,
    pub last_used_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// What the UI sends when creating or updating a prompt.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct PromptInput {
    pub id: Option<String>,
    pub title: String,
    pub body: String,
    pub folder_id: Option<String>,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub hotkey: Option<String>,
    pub trigger: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub sort_order: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PasteMethod {
    Clipboard,
    Type,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PasteKeystroke {
    CtrlV,
    CtrlShiftV,
    ShiftInsert,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub palette_hotkey: String,
    pub paste_method: PasteMethod,
    pub paste_keystroke: PasteKeystroke,
    pub restore_clipboard: bool,
    pub restore_delay_ms: u64,
    pub triggers_enabled: bool,
    pub launch_at_login: bool,
    pub paused: bool,
    pub onboarding_complete: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            palette_hotkey: "Ctrl+Shift+Space".into(),
            paste_method: PasteMethod::Clipboard,
            paste_keystroke: PasteKeystroke::CtrlV,
            restore_clipboard: true,
            restore_delay_ms: 300,
            triggers_enabled: true,
            launch_at_login: false,
            paused: false,
            onboarding_complete: false,
        }
    }
}

impl Settings {
    /// Clamp values the UI (or a hand-edited file) could get wrong.
    pub fn sanitized(mut self) -> Self {
        self.restore_delay_ms = self.restore_delay_ms.clamp(50, 2000);
        self
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ImportReport {
    pub prompts_added: usize,
    pub prompts_updated: usize,
    pub folders_added: usize,
    /// Human-readable notes about shortcuts that were dropped because of conflicts.
    pub warnings: Vec<String>,
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Lower-case, trim, drop empties and duplicates while keeping order.
pub fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for t in tags {
        let t = t.trim().to_lowercase();
        if !t.is_empty() && t.chars().count() <= 40 && !out.contains(&t) {
            out.push(t);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tags_are_normalized() {
        let tags = vec![" Git ".into(), "git".into(), "".into(), "Review".into()];
        assert_eq!(normalize_tags(&tags), vec!["git", "review"]);
    }

    #[test]
    fn settings_deserialize_with_missing_fields() {
        let s: Settings = serde_json::from_str(r#"{"paused":true}"#).unwrap();
        assert!(s.paused);
        assert_eq!(s.palette_hotkey, "Ctrl+Shift+Space");
        assert_eq!(s.paste_method, PasteMethod::Clipboard);
    }

    #[test]
    fn restore_delay_is_clamped() {
        let s = Settings { restore_delay_ms: 5, ..Default::default() }.sanitized();
        assert_eq!(s.restore_delay_ms, 50);
    }
}
