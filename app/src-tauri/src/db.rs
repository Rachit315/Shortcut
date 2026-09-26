//! SQLite persistence. All methods return user-presentable error strings.

use crate::hotkey;
use crate::io::{ExportData, ExportFolder, ExportPrompt};
use crate::models::*;
use crate::triggers;
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::HashMap;
use std::path::Path;

pub type Result<T> = std::result::Result<T, String>;

fn db_err(e: rusqlite::Error) -> String {
    format!("Database error: {e}")
}

pub struct Store {
    conn: Connection,
}

const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS folders (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS prompts (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    body         TEXT NOT NULL,
    folder_id    TEXT NULL REFERENCES folders(id) ON DELETE SET NULL,
    tags         TEXT NOT NULL DEFAULT '[]',
    favorite     INTEGER NOT NULL DEFAULT 0,
    hotkey       TEXT NULL UNIQUE,
    "trigger"    TEXT NULL UNIQUE,
    use_count    INTEGER NOT NULL DEFAULT 0,
    last_used_at INTEGER NULL,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS variable_values (
    prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    name      TEXT NOT NULL,
    value     TEXT NOT NULL,
    PRIMARY KEY (prompt_id, name)
);
CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;

const PROMPT_COLS: &str =
    r#"id, title, body, folder_id, tags, favorite, hotkey, "trigger", use_count, last_used_at, created_at, updated_at"#;

fn row_to_prompt(r: &Row) -> rusqlite::Result<Prompt> {
    let tags: String = r.get(4)?;
    Ok(Prompt {
        id: r.get(0)?,
        title: r.get(1)?,
        body: r.get(2)?,
        folder_id: r.get(3)?,
        tags: serde_json::from_str(&tags).unwrap_or_default(),
        favorite: r.get::<_, i64>(5)? != 0,
        hotkey: r.get(6)?,
        trigger: r.get(7)?,
        use_count: r.get(8)?,
        last_used_at: r.get(9)?,
        created_at: r.get(10)?,
        updated_at: r.get(11)?,
    })
}

struct Starter {
    title: &'static str,
    folder: &'static str,
    tags: &'static [&'static str],
    hotkey: Option<&'static str>,
    trigger: &'static str,
    favorite: bool,
    body: &'static str,
}

const STARTERS: &[Starter] = &[
    Starter {
        title: "Code review",
        folder: "Coding",
        tags: &["code", "review"],
        hotkey: Some("Ctrl+Alt+1"),
        trigger: ";review",
        favorite: true,
        body: "Review the following code as a senior engineer. List bugs, security issues, performance problems and missing tests, ordered by severity. For each issue, quote the line and suggest a concrete fix.\n\n{{clipboard}}",
    },
    Starter {
        title: "Commit & push",
        folder: "Coding",
        tags: &["git"],
        hotkey: Some("Ctrl+Alt+2"),
        trigger: ";push",
        favorite: true,
        body: "Look at my staged and unstaged changes, group them into logical commits with clear Conventional Commit messages (feat:, fix:, docs:, refactor:, test:), show me the list of commits, then push the current branch to origin.",
    },
    Starter {
        title: "Write tests",
        folder: "Coding",
        tags: &["code", "tests"],
        hotkey: None,
        trigger: ";tests",
        favorite: false,
        body: "Write thorough unit tests for the code below using {{framework=the project's existing test framework}}. Cover edge cases, failure paths and at least one realistic end-to-end scenario.\n\n{{clipboard}}",
    },
    Starter {
        title: "Explain simply",
        folder: "Coding",
        tags: &["learning"],
        hotkey: None,
        trigger: ";eli5",
        favorite: false,
        body: "Explain the following to a smart beginner. Use one analogy, one short example, and finish with the single most important takeaway.\n\n{{clipboard}}",
    },
    Starter {
        title: "Image style: cinematic",
        folder: "Images",
        tags: &["image", "midjourney"],
        hotkey: Some("Ctrl+Alt+3"),
        trigger: ";img",
        favorite: false,
        body: "{{subject}}, cinematic lighting, soft film grain, shallow depth of field, 35mm lens, muted {{palette=teal and orange}} colour palette, highly detailed --ar {{aspect:16:9|1:1|9:16}}",
    },
];

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path).map_err(db_err)?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory().map_err(db_err)?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;")
            .map_err(db_err)?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(db_err)?;
        if version < 1 {
            conn.execute_batch(SCHEMA_V1).map_err(db_err)?;
            conn.execute_batch("PRAGMA user_version = 1").map_err(db_err)?;
        }
        Ok(Self { conn })
    }

    /// Insert the starter pack the very first time the app runs.
    pub fn seed_if_first_run(&mut self) -> Result<bool> {
        if self.kv_get("seeded")?.is_some() {
            return Ok(false);
        }
        let tx = self.conn.transaction().map_err(db_err)?;
        let mut folder_ids: HashMap<&str, String> = HashMap::new();
        let now = now_ms();
        for (i, name) in ["Coding", "Images"].iter().enumerate() {
            let id = new_id();
            tx.execute("INSERT INTO folders (id, name, sort_order, created_at) VALUES (?1, ?2, ?3, ?4)", params![id, name, i as i64, now])
                .map_err(db_err)?;
            folder_ids.insert(name, id);
        }
        for (i, s) in STARTERS.iter().enumerate() {
            let tags = serde_json::to_string(&s.tags).unwrap();
            tx.execute(
                r#"INSERT INTO prompts (id, title, body, folder_id, tags, favorite, hotkey, "trigger", created_at, updated_at)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)"#,
                params![new_id(), s.title, s.body, folder_ids[s.folder], tags, s.favorite as i64, s.hotkey, s.trigger, now + i as i64],
            )
            .map_err(db_err)?;
        }
        tx.execute("INSERT INTO kv (key, value) VALUES ('seeded', '1')", []).map_err(db_err)?;
        tx.commit().map_err(db_err)?;
        Ok(true)
    }

    fn kv_get(&self, key: &str) -> Result<Option<String>> {
        self.conn.query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0)).optional().map_err(db_err)
    }

    fn kv_set(&self, key: &str, value: &str) -> Result<()> {
        self.conn
            .execute("INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value])
            .map_err(db_err)?;
        Ok(())
    }

    // ---------- settings ----------

    pub fn settings(&self) -> Result<Settings> {
        Ok(self
            .kv_get("settings")?
            .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
            .unwrap_or_default()
            .sanitized())
    }

    pub fn save_settings(&self, settings: Settings) -> Result<Settings> {
        let mut settings = settings.sanitized();
        settings.palette_hotkey = hotkey::normalize(&settings.palette_hotkey).map_err(|e| format!("Palette hotkey: {e}"))?;
        if let Some(owner) = self.prompt_with_hotkey(&settings.palette_hotkey, None)? {
            return Err(format!("Palette hotkey is already used by '{}'.", owner.title));
        }
        self.kv_set("settings", &serde_json::to_string(&settings).unwrap())?;
        Ok(settings)
    }

    // ---------- prompts ----------

    pub fn list_prompts(&self) -> Result<Vec<Prompt>> {
        let mut stmt = self
            .conn
            .prepare(&format!("SELECT {PROMPT_COLS} FROM prompts ORDER BY favorite DESC, lower(title)"))
            .map_err(db_err)?;
        let rows = stmt.query_map([], row_to_prompt).map_err(db_err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_err)
    }

    pub fn get_prompt(&self, id: &str) -> Result<Prompt> {
        self.conn
            .query_row(&format!("SELECT {PROMPT_COLS} FROM prompts WHERE id = ?1"), [id], row_to_prompt)
            .optional()
            .map_err(db_err)?
            .ok_or_else(|| "That prompt no longer exists.".to_string())
    }

    fn prompt_with_hotkey(&self, accel: &str, exclude: Option<&str>) -> Result<Option<Prompt>> {
        let p = self
            .conn
            .query_row(&format!("SELECT {PROMPT_COLS} FROM prompts WHERE hotkey = ?1"), [accel], row_to_prompt)
            .optional()
            .map_err(db_err)?;
        Ok(p.filter(|p| Some(p.id.as_str()) != exclude))
    }

    fn prompt_with_trigger(&self, trigger: &str, exclude: Option<&str>) -> Result<Option<Prompt>> {
        let p = self
            .conn
            .query_row(&format!(r#"SELECT {PROMPT_COLS} FROM prompts WHERE "trigger" = ?1"#), [trigger], row_to_prompt)
            .optional()
            .map_err(db_err)?;
        Ok(p.filter(|p| Some(p.id.as_str()) != exclude))
    }

    /// Who owns this accelerator (for UI validation)? Includes the palette hotkey.
    pub fn hotkey_owner(&self, accel: &str, exclude_prompt: Option<&str>) -> Result<Option<String>> {
        self.hotkey_owner_ext(accel, exclude_prompt, true)
    }

    pub fn hotkey_owner_ext(&self, accel: &str, exclude_prompt: Option<&str>, include_palette: bool) -> Result<Option<String>> {
        if include_palette && self.settings()?.palette_hotkey == accel {
            return Ok(Some("the quick palette".into()));
        }
        Ok(self.prompt_with_hotkey(accel, exclude_prompt)?.map(|p| format!("'{}'", p.title)))
    }

    pub fn other_triggers(&self, exclude_prompt: Option<&str>) -> Result<Vec<(String, String)>> {
        Ok(self
            .list_prompts()?
            .into_iter()
            .filter(|p| Some(p.id.as_str()) != exclude_prompt)
            .filter_map(|p| p.trigger.map(|t| (t, p.title)))
            .collect())
    }

    fn clean_input(&self, input: &PromptInput, exclude: Option<&str>) -> Result<PromptInput> {
        let title = input.title.trim().to_string();
        if title.is_empty() {
            return Err("Give the prompt a title.".into());
        }
        if title.chars().count() > MAX_TITLE_CHARS {
            return Err(format!("Titles can be at most {MAX_TITLE_CHARS} characters."));
        }
        if input.body.trim().is_empty() {
            return Err("The prompt body is empty.".into());
        }
        if input.body.chars().count() > MAX_BODY_CHARS {
            return Err(format!("Prompts can be at most {MAX_BODY_CHARS} characters."));
        }
        let hotkey = match input.hotkey.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            None => None,
            Some(h) => {
                let accel = hotkey::normalize(h)?;
                if let Some(owner) = self.hotkey_owner(&accel, exclude)? {
                    return Err(format!("{accel} is already used by {owner}."));
                }
                Some(accel)
            }
        };
        let trigger = match input.trigger.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            None => None,
            Some(t) => {
                let t = triggers::validate(t)?;
                if let Some(owner) = self.prompt_with_trigger(&t, exclude)? {
                    return Err(format!("{t} is already used by '{}'.", owner.title));
                }
                Some(t)
            }
        };
        let folder_id = match input.folder_id.as_deref().filter(|s| !s.is_empty()) {
            None => None,
            Some(f) => {
                let exists: bool = self
                    .conn
                    .query_row("SELECT EXISTS(SELECT 1 FROM folders WHERE id = ?1)", [f], |r| r.get(0))
                    .map_err(db_err)?;
                exists.then(|| f.to_string())
            }
        };
        Ok(PromptInput {
            id: input.id.clone(),
            title,
            body: input.body.replace("\r\n", "\n"),
            folder_id,
            tags: normalize_tags(&input.tags),
            favorite: input.favorite,
            hotkey,
            trigger,
        })
    }

    pub fn save_prompt(&self, input: &PromptInput) -> Result<Prompt> {
        let existing_id = input.id.as_deref().filter(|s| !s.is_empty());
        if let Some(id) = existing_id {
            self.get_prompt(id)?;
        }
        let p = self.clean_input(input, existing_id)?;
        let now = now_ms();
        let tags = serde_json::to_string(&p.tags).unwrap();
        let id = match existing_id {
            Some(id) => {
                self.conn
                    .execute(
                        r#"UPDATE prompts SET title=?2, body=?3, folder_id=?4, tags=?5, favorite=?6, hotkey=?7, "trigger"=?8, updated_at=?9 WHERE id=?1"#,
                        params![id, p.title, p.body, p.folder_id, tags, p.favorite as i64, p.hotkey, p.trigger, now],
                    )
                    .map_err(db_err)?;
                id.to_string()
            }
            None => {
                let id = new_id();
                self.conn
                    .execute(
                        r#"INSERT INTO prompts (id, title, body, folder_id, tags, favorite, hotkey, "trigger", created_at, updated_at)
                           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)"#,
                        params![id, p.title, p.body, p.folder_id, tags, p.favorite as i64, p.hotkey, p.trigger, now],
                    )
                    .map_err(db_err)?;
                id
            }
        };
        self.get_prompt(&id)
    }

    pub fn delete_prompt(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM prompts WHERE id = ?1", [id]).map_err(db_err)?;
        Ok(())
    }

    pub fn duplicate_prompt(&self, id: &str) -> Result<Prompt> {
        let p = self.get_prompt(id)?;
        let mut title = format!("{} (copy)", p.title);
        if title.chars().count() > MAX_TITLE_CHARS {
            title = title.chars().take(MAX_TITLE_CHARS).collect();
        }
        self.save_prompt(&PromptInput {
            id: None,
            title,
            body: p.body,
            folder_id: p.folder_id,
            tags: p.tags,
            favorite: p.favorite,
            hotkey: None,
            trigger: None,
        })
    }

    pub fn record_use(&self, id: &str) -> Result<()> {
        self.conn
            .execute("UPDATE prompts SET use_count = use_count + 1, last_used_at = ?2 WHERE id = ?1", params![id, now_ms()])
            .map_err(db_err)?;
        Ok(())
    }

    pub fn variable_values(&self, prompt_id: &str) -> Result<HashMap<String, String>> {
        let mut stmt = self.conn.prepare("SELECT name, value FROM variable_values WHERE prompt_id = ?1").map_err(db_err)?;
        let rows = stmt.query_map([prompt_id], |r| Ok((r.get(0)?, r.get(1)?))).map_err(db_err)?;
        rows.collect::<rusqlite::Result<HashMap<_, _>>>().map_err(db_err)
    }

    pub fn save_variable_values(&self, prompt_id: &str, values: &HashMap<String, String>) -> Result<()> {
        for (k, v) in values {
            self.conn
                .execute(
                    "INSERT INTO variable_values (prompt_id, name, value) VALUES (?1, ?2, ?3)
                     ON CONFLICT(prompt_id, name) DO UPDATE SET value = excluded.value",
                    params![prompt_id, k, v],
                )
                .map_err(db_err)?;
        }
        Ok(())
    }

    // ---------- folders ----------

    pub fn list_folders(&self) -> Result<Vec<Folder>> {
        let mut stmt = self.conn.prepare("SELECT id, name, sort_order FROM folders ORDER BY sort_order, lower(name)").map_err(db_err)?;
        let rows = stmt
            .query_map([], |r| Ok(Folder { id: r.get(0)?, name: r.get(1)?, sort_order: r.get(2)? }))
            .map_err(db_err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_err)
    }

    pub fn save_folder(&self, id: Option<&str>, name: &str) -> Result<Folder> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 60 {
            return Err("Folder names need 1–60 characters.".into());
        }
        let id = match id.filter(|s| !s.is_empty()) {
            Some(id) => {
                let n = self.conn.execute("UPDATE folders SET name = ?2 WHERE id = ?1", params![id, name]).map_err(db_err)?;
                if n == 0 {
                    return Err("That folder no longer exists.".into());
                }
                id.to_string()
            }
            None => {
                let id = new_id();
                let order: i64 = self
                    .conn
                    .query_row("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM folders", [], |r| r.get(0))
                    .map_err(db_err)?;
                self.conn
                    .execute("INSERT INTO folders (id, name, sort_order, created_at) VALUES (?1, ?2, ?3, ?4)", params![id, name, order, now_ms()])
                    .map_err(db_err)?;
                id
            }
        };
        self.list_folders()?.into_iter().find(|f| f.id == id).ok_or_else(|| "Folder not found.".into())
    }

    pub fn delete_folder(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM folders WHERE id = ?1", [id]).map_err(db_err)?;
        Ok(())
    }

    // ---------- import / export ----------

    pub fn export(&self) -> Result<ExportData> {
        let folders = self.list_folders()?.into_iter().map(|f| ExportFolder { id: f.id, name: f.name }).collect();
        let prompts = self
            .list_prompts()?
            .into_iter()
            .map(|p| ExportPrompt {
                id: Some(p.id),
                title: p.title,
                body: p.body,
                folder_id: p.folder_id,
                folder_name: None,
                tags: p.tags,
                favorite: p.favorite,
                hotkey: p.hotkey,
                trigger: p.trigger,
            })
            .collect();
        Ok(ExportData::new(folders, prompts))
    }

    fn folder_by_name(&self, name: &str) -> Result<Option<String>> {
        self.conn
            .query_row("SELECT id FROM folders WHERE lower(name) = lower(?1)", [name.trim()], |r| r.get(0))
            .optional()
            .map_err(db_err)
    }

    pub fn import(&mut self, data: &ExportData) -> Result<ImportReport> {
        let mut report = ImportReport::default();
        self.conn.execute_batch("BEGIN").map_err(db_err)?;
        let result = self.import_inner(data, &mut report);
        match result {
            Ok(()) => {
                self.conn.execute_batch("COMMIT").map_err(db_err)?;
                Ok(report)
            }
            Err(e) => {
                let _ = self.conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }

    fn import_inner(&self, data: &ExportData, report: &mut ImportReport) -> Result<()> {
        // Map file folder ids → local folder ids (matching by name, creating when missing).
        let mut folder_map: HashMap<String, String> = HashMap::new();
        let resolve_name = |name: &str, report: &mut ImportReport| -> Result<Option<String>> {
            if name.trim().is_empty() {
                return Ok(None);
            }
            if let Some(id) = self.folder_by_name(name)? {
                return Ok(Some(id));
            }
            let f = self.save_folder(None, &name.chars().take(60).collect::<String>())?;
            report.folders_added += 1;
            Ok(Some(f.id))
        };
        for f in &data.folders {
            if let Some(local) = resolve_name(&f.name, report)? {
                folder_map.insert(f.id.clone(), local);
            }
        }
        for p in &data.prompts {
            let folder_id = match (&p.folder_id, &p.folder_name) {
                (Some(fid), _) if folder_map.contains_key(fid) => Some(folder_map[fid].clone()),
                (_, Some(name)) => resolve_name(name, report)?,
                _ => None,
            };
            let id = p.id.as_deref().map(str::trim).filter(|s| !s.is_empty() && s.len() <= 64);
            let exists = match id {
                Some(id) => self.get_prompt(id).is_ok(),
                None => false,
            };
            let mut input = PromptInput {
                id: None,
                title: p.title.clone(),
                body: p.body.clone(),
                folder_id,
                tags: p.tags.clone(),
                favorite: p.favorite,
                hotkey: p.hotkey.clone(),
                trigger: p.trigger.clone(),
            };
            let exclude = if exists { id } else { None };
            // Drop shortcuts that clash instead of failing the whole import.
            if let Some(h) = input.hotkey.clone().filter(|h| !h.trim().is_empty()) {
                let problem = match hotkey::normalize(&h) {
                    Err(e) => Some(e),
                    Ok(a) => self.hotkey_owner(&a, exclude)?.map(|o| format!("already used by {o}")),
                };
                if let Some(problem) = problem {
                    report.warnings.push(format!("'{}': hotkey {h} was skipped ({problem}).", p.title));
                    input.hotkey = None;
                }
            }
            if let Some(t) = input.trigger.clone().filter(|t| !t.trim().is_empty()) {
                let problem = match triggers::validate(&t) {
                    Err(e) => Some(e),
                    Ok(t) => self.prompt_with_trigger(&t, exclude)?.map(|o| format!("already used by '{}'", o.title)),
                };
                if let Some(problem) = problem {
                    report.warnings.push(format!("'{}': trigger {t} was skipped ({problem}).", p.title));
                    input.trigger = None;
                }
            }
            let cleaned = match self.clean_input(&input, exclude) {
                Ok(c) => c,
                Err(e) => {
                    report.warnings.push(format!("'{}' was skipped: {e}", p.title));
                    continue;
                }
            };
            let tags = serde_json::to_string(&cleaned.tags).unwrap();
            let now = now_ms();
            if exists {
                self.conn
                    .execute(
                        r#"UPDATE prompts SET title=?2, body=?3, folder_id=?4, tags=?5, favorite=?6, hotkey=?7, "trigger"=?8, updated_at=?9 WHERE id=?1"#,
                        params![id.unwrap(), cleaned.title, cleaned.body, cleaned.folder_id, tags, cleaned.favorite as i64, cleaned.hotkey, cleaned.trigger, now],
                    )
                    .map_err(db_err)?;
                report.prompts_updated += 1;
            } else {
                let new = id.map(String::from).unwrap_or_else(new_id);
                self.conn
                    .execute(
                        r#"INSERT INTO prompts (id, title, body, folder_id, tags, favorite, hotkey, "trigger", created_at, updated_at)
                           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)"#,
                        params![new, cleaned.title, cleaned.body, cleaned.folder_id, tags, cleaned.favorite as i64, cleaned.hotkey, cleaned.trigger, now],
                    )
                    .map_err(db_err)?;
                report.prompts_added += 1;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io;

    fn store() -> Store {
        Store::open_in_memory().unwrap()
    }

    fn input(title: &str, hotkey: Option<&str>, trigger: Option<&str>) -> PromptInput {
        PromptInput {
            title: title.into(),
            body: format!("Body of {title}"),
            hotkey: hotkey.map(String::from),
            trigger: trigger.map(String::from),
            ..Default::default()
        }
    }

    #[test]
    fn seeds_starter_pack_once() {
        let mut s = store();
        assert!(s.seed_if_first_run().unwrap());
        assert!(!s.seed_if_first_run().unwrap());
        let prompts = s.list_prompts().unwrap();
        assert_eq!(prompts.len(), STARTERS.len());
        assert_eq!(s.list_folders().unwrap().len(), 2);
        assert!(prompts.iter().any(|p| p.trigger.as_deref() == Some(";push")));
        // Favourites sort first.
        assert!(prompts[0].favorite);
        // Deleting starters must not bring them back.
        for p in prompts {
            s.delete_prompt(&p.id).unwrap();
        }
        s.seed_if_first_run().unwrap();
        assert!(s.list_prompts().unwrap().is_empty());
    }

    #[test]
    fn every_starter_hotkey_is_canonical() {
        for st in STARTERS {
            if let Some(h) = st.hotkey {
                assert_eq!(hotkey::normalize(h).unwrap(), h);
            }
            triggers::validate(st.trigger).unwrap();
        }
    }

    #[test]
    fn crud_round_trip() {
        let s = store();
        let p = s.save_prompt(&PromptInput { tags: vec!["Git".into(), "git".into()], ..input("Push", Some("alt+ctrl+5"), Some(";push")) }).unwrap();
        assert_eq!(p.hotkey.as_deref(), Some("Ctrl+Alt+5"));
        assert_eq!(p.tags, vec!["git"]);
        let mut edit = input("Push v2", None, Some(";push"));
        edit.id = Some(p.id.clone());
        let p2 = s.save_prompt(&edit).unwrap();
        assert_eq!(p2.title, "Push v2");
        assert_eq!(p2.hotkey, None);
        assert_eq!(p2.created_at, p.created_at);
        s.delete_prompt(&p.id).unwrap();
        assert!(s.get_prompt(&p.id).is_err());
    }

    #[test]
    fn validation_errors_are_friendly() {
        let s = store();
        assert!(s.save_prompt(&input("", None, None)).unwrap_err().contains("title"));
        let mut empty = input("x", None, None);
        empty.body = "  ".into();
        assert!(s.save_prompt(&empty).unwrap_err().contains("empty"));
        let mut long = input("x", None, None);
        long.body = "a".repeat(MAX_BODY_CHARS + 1);
        assert!(s.save_prompt(&long).is_err());
        assert!(s.save_prompt(&input("x", Some("A"), None)).is_err());
        assert!(s.save_prompt(&input("x", None, Some("a b"))).is_err());
    }

    #[test]
    fn shortcut_uniqueness_is_enforced() {
        let s = store();
        s.save_prompt(&input("One", Some("Ctrl+Alt+1"), Some(";one"))).unwrap();
        let e = s.save_prompt(&input("Two", Some("ctrl+alt+1"), None)).unwrap_err();
        assert!(e.contains("'One'"), "{e}");
        let e = s.save_prompt(&input("Two", None, Some(";one"))).unwrap_err();
        assert!(e.contains("'One'"), "{e}");
        let e = s.save_prompt(&input("Two", Some("Ctrl+Shift+Space"), None)).unwrap_err();
        assert!(e.contains("palette"), "{e}");
    }

    #[test]
    fn settings_round_trip_and_palette_conflict() {
        let s = store();
        assert_eq!(s.settings().unwrap(), Settings::default());
        s.save_prompt(&input("One", Some("Ctrl+Alt+1"), None)).unwrap();
        let bad = Settings { palette_hotkey: "Ctrl+Alt+1".into(), ..Default::default() };
        assert!(s.save_settings(bad).is_err());
        let ok = s.save_settings(Settings { palette_hotkey: "alt+space+ctrl".into(), paused: true, ..Default::default() }).unwrap();
        assert_eq!(ok.palette_hotkey, "Ctrl+Alt+Space");
        assert!(s.settings().unwrap().paused);
    }

    #[test]
    fn duplicate_drops_shortcuts() {
        let s = store();
        let p = s.save_prompt(&input("One", Some("Ctrl+Alt+1"), Some(";one"))).unwrap();
        let d = s.duplicate_prompt(&p.id).unwrap();
        assert_eq!(d.title, "One (copy)");
        assert_eq!(d.body, p.body);
        assert!(d.hotkey.is_none() && d.trigger.is_none());
    }

    #[test]
    fn folders_and_prompt_reassignment() {
        let s = store();
        let f = s.save_folder(None, " Work ").unwrap();
        assert_eq!(f.name, "Work");
        let p = s.save_prompt(&PromptInput { folder_id: Some(f.id.clone()), ..input("One", None, None) }).unwrap();
        assert_eq!(p.folder_id.as_deref(), Some(f.id.as_str()));
        s.save_folder(Some(&f.id), "Job").unwrap();
        s.delete_folder(&f.id).unwrap();
        assert_eq!(s.get_prompt(&p.id).unwrap().folder_id, None);
        // Unknown folder ids are ignored rather than failing.
        let p = s.save_prompt(&PromptInput { folder_id: Some("nope".into()), ..input("Two", None, None) }).unwrap();
        assert_eq!(p.folder_id, None);
    }

    #[test]
    fn usage_and_variable_memory() {
        let s = store();
        let p = s.save_prompt(&input("One", None, None)).unwrap();
        s.record_use(&p.id).unwrap();
        s.record_use(&p.id).unwrap();
        let p = s.get_prompt(&p.id).unwrap();
        assert_eq!(p.use_count, 2);
        assert!(p.last_used_at.is_some());
        let mut v = HashMap::new();
        v.insert("subject".to_string(), "a fox".to_string());
        s.save_variable_values(&p.id, &v).unwrap();
        v.insert("subject".to_string(), "a cat".to_string());
        s.save_variable_values(&p.id, &v).unwrap();
        assert_eq!(s.variable_values(&p.id).unwrap()["subject"], "a cat");
    }

    #[test]
    fn export_import_round_trip_into_fresh_store() {
        let mut a = store();
        a.seed_if_first_run().unwrap();
        let json = io::to_json(&a.export().unwrap());

        let mut b = Store::open_in_memory().unwrap();
        let report = b.import(&io::from_json(&json).unwrap()).unwrap();
        assert_eq!(report.prompts_added, STARTERS.len());
        assert_eq!(report.folders_added, 2);
        assert!(report.warnings.is_empty(), "{:?}", report.warnings);
        let pa = a.list_prompts().unwrap();
        let pb = b.list_prompts().unwrap();
        for (x, y) in pa.iter().zip(pb.iter()) {
            assert_eq!((&x.id, &x.title, &x.body, &x.hotkey, &x.trigger, &x.tags), (&y.id, &y.title, &y.body, &y.hotkey, &y.trigger, &y.tags));
        }
        // Importing again updates instead of duplicating.
        let report = b.import(&io::from_json(&json).unwrap()).unwrap();
        assert_eq!(report.prompts_updated, STARTERS.len());
        assert_eq!(b.list_prompts().unwrap().len(), STARTERS.len());
    }

    #[test]
    fn import_drops_conflicting_shortcuts_with_warnings() {
        let mut s = store();
        s.save_prompt(&input("Mine", Some("Ctrl+Alt+1"), Some(";x"))).unwrap();
        let md = "## Theirs\n<!-- shortcut\nhotkey: Ctrl+Alt+1\ntrigger: ;x\nfolder: Shared\n-->\n\n````text\nHello\n````\n\n## Empty\n\n";
        let report = s.import(&io::from_markdown(md).unwrap()).unwrap();
        assert_eq!(report.prompts_added, 1);
        assert_eq!(report.folders_added, 1);
        assert_eq!(report.warnings.len(), 3, "{:?}", report.warnings); // hotkey, trigger, empty body
        let theirs = s.list_prompts().unwrap().into_iter().find(|p| p.title == "Theirs").unwrap();
        assert!(theirs.hotkey.is_none() && theirs.trigger.is_none());
        assert!(theirs.folder_id.is_some());
    }

    #[test]
    fn persists_to_disk() {
        let dir = std::env::temp_dir().join(format!("shortcut-test-{}", new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("shortcut.db");
        {
            let mut s = Store::open(&path).unwrap();
            s.seed_if_first_run().unwrap();
        }
        let s = Store::open(&path).unwrap();
        assert_eq!(s.list_prompts().unwrap().len(), STARTERS.len());
        std::fs::remove_dir_all(dir).ok();
    }
}
