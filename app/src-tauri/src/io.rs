//! Import / export formats (pure; the database merge lives in `db.rs`).

use serde::{Deserialize, Serialize};

pub const EXPORT_VERSION: u32 = 1;
pub const MAX_IMPORT_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExportFolder {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExportPrompt {
    #[serde(default)]
    pub id: Option<String>,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub folder_id: Option<String>,
    /// Markdown files reference folders by name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder_name: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub hotkey: Option<String>,
    #[serde(default)]
    pub trigger: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExportData {
    pub app: String,
    pub version: u32,
    #[serde(default)]
    pub exported_at: String,
    #[serde(default)]
    pub folders: Vec<ExportFolder>,
    pub prompts: Vec<ExportPrompt>,
}

impl ExportData {
    pub fn new(folders: Vec<ExportFolder>, prompts: Vec<ExportPrompt>) -> Self {
        Self {
            app: "shortcut".into(),
            version: EXPORT_VERSION,
            exported_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            folders,
            prompts,
        }
    }
}

pub fn to_json(data: &ExportData) -> String {
    serde_json::to_string_pretty(data).expect("export data is always serialisable")
}

pub fn from_json(text: &str) -> Result<ExportData, String> {
    let data: ExportData = serde_json::from_str(text).map_err(|e| format!("Not a valid Shortcut JSON export: {e}"))?;
    if data.app != "shortcut" {
        return Err("This JSON file was not exported by Shortcut.".into());
    }
    if data.version > EXPORT_VERSION {
        return Err(format!("This file needs a newer version of Shortcut (format v{}).", data.version));
    }
    Ok(data)
}

fn fence_for(body: &str) -> String {
    let mut longest = 0;
    let mut run = 0;
    for c in body.chars() {
        if c == '`' {
            run += 1;
            longest = longest.max(run);
        } else {
            run = 0;
        }
    }
    "`".repeat((longest + 1).max(4))
}

fn one_line(s: &str) -> String {
    s.replace(['\n', '\r'], " ")
}

pub fn to_markdown(data: &ExportData) -> String {
    let mut out = String::from("# Shortcut prompts\n\n");
    out.push_str(&format!("<!-- Exported {} · format v{} -->\n", data.exported_at, data.version));
    for p in &data.prompts {
        out.push_str(&format!("\n## {}\n\n<!-- shortcut\n", one_line(&p.title)));
        if let Some(id) = &p.id {
            out.push_str(&format!("id: {id}\n"));
        }
        let folder = p
            .folder_name
            .clone()
            .or_else(|| p.folder_id.as_ref().and_then(|fid| data.folders.iter().find(|f| &f.id == fid)).map(|f| f.name.clone()));
        if let Some(f) = folder {
            out.push_str(&format!("folder: {}\n", one_line(&f)));
        }
        if !p.tags.is_empty() {
            out.push_str(&format!("tags: {}\n", p.tags.join(", ")));
        }
        if p.favorite {
            out.push_str("favorite: true\n");
        }
        if let Some(h) = &p.hotkey {
            out.push_str(&format!("hotkey: {h}\n"));
        }
        if let Some(t) = &p.trigger {
            out.push_str(&format!("trigger: {t}\n"));
        }
        let fence = fence_for(&p.body);
        out.push_str(&format!("-->\n\n{fence}text\n{}\n{fence}\n", p.body));
    }
    out
}

pub fn from_markdown(text: &str) -> Result<ExportData, String> {
    let text = text.replace("\r\n", "\n");
    let lines: Vec<&str> = text.lines().collect();
    let mut prompts: Vec<ExportPrompt> = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let Some(title) = lines[i].strip_prefix("## ") else {
            i += 1;
            continue;
        };
        let mut p = ExportPrompt {
            id: None,
            title: title.trim().to_string(),
            body: String::new(),
            folder_id: None,
            folder_name: None,
            tags: vec![],
            favorite: false,
            hotkey: None,
            trigger: None,
        };
        i += 1;
        // Optional metadata comment.
        while i < lines.len() && lines[i].trim().is_empty() {
            i += 1;
        }
        if i < lines.len() && lines[i].trim() == "<!-- shortcut" {
            i += 1;
            while i < lines.len() && lines[i].trim() != "-->" {
                if let Some((k, v)) = lines[i].split_once(':') {
                    let v = v.trim().to_string();
                    match k.trim() {
                        "id" => p.id = Some(v),
                        "folder" => p.folder_name = Some(v),
                        "tags" => p.tags = v.split(',').map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect(),
                        "favorite" => p.favorite = v == "true",
                        "hotkey" => p.hotkey = Some(v),
                        "trigger" => p.trigger = Some(v),
                        _ => {}
                    }
                }
                i += 1;
            }
            i += 1;
        }
        while i < lines.len() && lines[i].trim().is_empty() {
            i += 1;
        }
        // Fenced body.
        if i < lines.len() && lines[i].starts_with("```") {
            let fence: String = lines[i].chars().take_while(|c| *c == '`').collect();
            i += 1;
            let start = i;
            while i < lines.len() && lines[i].trim_end() != fence {
                i += 1;
            }
            if i >= lines.len() {
                return Err(format!("The body of '{}' is missing its closing {fence} fence.", p.title));
            }
            p.body = lines[start..i].join("\n");
            i += 1;
        } else {
            // Unfenced: everything until the next "## " heading.
            let start = i;
            while i < lines.len() && !lines[i].starts_with("## ") {
                i += 1;
            }
            p.body = lines[start..i].join("\n").trim().to_string();
        }
        if !p.title.is_empty() {
            prompts.push(p);
        }
    }
    if prompts.is_empty() {
        return Err("No prompts found. Each prompt needs a '## Title' heading.".into());
    }
    Ok(ExportData::new(vec![], prompts))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> ExportData {
        ExportData::new(
            vec![ExportFolder { id: "f1".into(), name: "Coding".into() }],
            vec![
                ExportPrompt {
                    id: Some("p1".into()),
                    title: "Code review".into(),
                    body: "Review this:\n```rust\nfn main() {}\n```\n{{cursor}}".into(),
                    folder_id: Some("f1".into()),
                    folder_name: None,
                    tags: vec!["review".into(), "code".into()],
                    favorite: true,
                    hotkey: Some("Ctrl+Alt+1".into()),
                    trigger: Some(";rev".into()),
                },
                ExportPrompt {
                    id: Some("p2".into()),
                    title: "Plain".into(),
                    body: "Four ```` ticks".into(),
                    folder_id: None,
                    folder_name: None,
                    tags: vec![],
                    favorite: false,
                    hotkey: None,
                    trigger: None,
                },
            ],
        )
    }

    #[test]
    fn json_round_trip() {
        let d = sample();
        assert_eq!(from_json(&to_json(&d)).unwrap(), d);
    }

    #[test]
    fn json_rejects_foreign_or_future_files() {
        assert!(from_json("{}").is_err());
        assert!(from_json(r#"{"app":"other","version":1,"prompts":[]}"#).is_err());
        assert!(from_json(r#"{"app":"shortcut","version":99,"prompts":[]}"#).is_err());
    }

    #[test]
    fn markdown_round_trip_preserves_bodies_and_metadata() {
        let d = sample();
        let md = to_markdown(&d);
        assert!(md.contains("`````text")); // body with 4 backticks gets a 5-backtick fence
        let back = from_markdown(&md).unwrap();
        assert_eq!(back.prompts.len(), 2);
        let p = &back.prompts[0];
        assert_eq!(p.title, "Code review");
        assert_eq!(p.body, d.prompts[0].body);
        assert_eq!(p.folder_name.as_deref(), Some("Coding"));
        assert_eq!(p.tags, vec!["review", "code"]);
        assert!(p.favorite);
        assert_eq!(p.hotkey.as_deref(), Some("Ctrl+Alt+1"));
        assert_eq!(p.trigger.as_deref(), Some(";rev"));
        assert_eq!(back.prompts[1].body, "Four ```` ticks");
    }

    #[test]
    fn markdown_import_accepts_handwritten_files() {
        let md = "# My prompts\n\n## Summarise\nSummarise this in 3 bullets:\n{{clipboard}}\n\n## Translate\n\n```\nTranslate to {{language=French}}\n```\n";
        let d = from_markdown(md).unwrap();
        assert_eq!(d.prompts[0].body, "Summarise this in 3 bullets:\n{{clipboard}}");
        assert_eq!(d.prompts[1].body, "Translate to {{language=French}}");
    }

    #[test]
    fn markdown_import_errors_are_clear() {
        assert!(from_markdown("just text").unwrap_err().contains("No prompts"));
        assert!(from_markdown("## A\n````\nunclosed").unwrap_err().contains("closing"));
    }
}
