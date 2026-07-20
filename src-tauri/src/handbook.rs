use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

use crate::{create_connection, now_ms, AppState};

const SEED_MARKDOWNS: &[(&str, &str)] = &[
    (
        "system.disk",
        include_str!("../resources/runbooks/system.disk.md"),
    ),
    (
        "system.memory",
        include_str!("../resources/runbooks/system.memory.md"),
    ),
    (
        "system.files",
        include_str!("../resources/runbooks/system.files.md"),
    ),
    (
        "network.basic",
        include_str!("../resources/runbooks/network.basic.md"),
    ),
    (
        "docker.basic",
        include_str!("../resources/runbooks/docker.basic.md"),
    ),
    (
        "docker.cleanup",
        include_str!("../resources/runbooks/docker.cleanup.md"),
    ),
];

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommandStep {
    pub id: i64,
    pub runbook_id: i64,
    pub sort_order: i64,
    pub title: String,
    pub command: String,
    pub note: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommandRunbook {
    pub id: i64,
    pub seed_key: Option<String>,
    pub title: String,
    pub category: String,
    pub problem: String,
    pub content_md: String,
    pub source: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub steps: Vec<CommandStep>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommandRunbookSummary {
    pub id: i64,
    pub seed_key: Option<String>,
    pub title: String,
    pub category: String,
    pub problem: String,
    pub source: String,
    pub step_count: i64,
    pub updated_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRunbookPayload {
    pub id: Option<i64>,
    pub title: String,
    pub category: String,
    pub problem: String,
    pub content_md: Option<String>,
    pub steps: Vec<SaveStepPayload>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveStepPayload {
    pub title: String,
    pub command: String,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportMarkdownPayload {
    pub content_md: String,
}

#[derive(Debug, Clone)]
struct ParsedRunbook {
    seed_key: Option<String>,
    title: String,
    category: String,
    problem: String,
    content_md: String,
    steps: Vec<SaveStepPayload>,
}

pub fn init_handbook_tables(db_path: &PathBuf) -> Result<(), String> {
    let connection = create_connection(db_path)?;
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS command_runbooks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                seed_key TEXT,
                title TEXT NOT NULL,
                category TEXT NOT NULL,
                problem TEXT NOT NULL DEFAULT '',
                content_md TEXT NOT NULL,
                source TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_command_runbooks_seed_key
                ON command_runbooks(seed_key)
                WHERE seed_key IS NOT NULL;

            CREATE TABLE IF NOT EXISTS command_steps (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                runbook_id INTEGER NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                title TEXT NOT NULL DEFAULT '',
                command TEXT NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                FOREIGN KEY(runbook_id) REFERENCES command_runbooks(id) ON DELETE CASCADE
            );
            ",
        )
        .map_err(|error| error.to_string())?;

    seed_builtin_runbooks(&connection)?;
    Ok(())
}

fn seed_builtin_runbooks(connection: &Connection) -> Result<(), String> {
    for (seed_key, markdown) in SEED_MARKDOWNS {
        let exists: Option<i64> = connection
            .query_row(
                "SELECT id FROM command_runbooks WHERE seed_key = ?1",
                params![seed_key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;

        if exists.is_some() {
            continue;
        }

        let parsed = parse_markdown(markdown, Some((*seed_key).to_string()), "builtin")?;
        insert_runbook(connection, &parsed, "builtin")?;
    }
    Ok(())
}

fn parse_front_matter(content: &str) -> (std::collections::HashMap<String, String>, String) {
    let trimmed = content.trim_start_matches('\u{feff}').trim();
    if !trimmed.starts_with("---") {
        return (std::collections::HashMap::new(), content.to_string());
    }

    let rest = &trimmed[3..];
    if let Some(end) = rest.find("\n---") {
        let meta_block = &rest[..end];
        let body = rest[end + 4..].trim_start_matches('\r').trim_start_matches('\n');
        let mut map = std::collections::HashMap::new();
        for line in meta_block.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Some((key, value)) = line.split_once(':') {
                map.insert(key.trim().to_string(), value.trim().to_string());
            }
        }
        return (map, body.to_string());
    }

    (std::collections::HashMap::new(), content.to_string())
}

fn extract_problem(body: &str) -> String {
    let lines: Vec<&str> = body.lines().collect();
    let mut in_problem = false;
    let mut collected = Vec::new();

    for line in lines {
        let trimmed = line.trim();
        if trimmed.starts_with("## ") {
            if in_problem {
                break;
            }
            let title = trimmed.trim_start_matches('#').trim();
            in_problem = title == "问题" || title.eq_ignore_ascii_case("problem");
            continue;
        }
        if in_problem {
            if !trimmed.is_empty() {
                collected.push(trimmed.to_string());
            }
        }
    }

    collected.join("\n")
}

fn extract_steps(body: &str) -> Vec<SaveStepPayload> {
    let mut steps = Vec::new();
    let mut current_title = String::new();
    let mut in_code = false;
    let mut code_lang = String::new();
    let mut code_lines: Vec<String> = Vec::new();

    for line in body.lines() {
        let trimmed = line.trim();
        if !in_code && trimmed.starts_with("### ") {
            current_title = trimmed.trim_start_matches('#').trim().to_string();
            continue;
        }

        if !in_code && trimmed.starts_with("```") {
            in_code = true;
            code_lang = trimmed.trim_start_matches('`').trim().to_lowercase();
            code_lines.clear();
            continue;
        }

        if in_code && trimmed.starts_with("```") {
            in_code = false;
            let command = code_lines.join("\n").trim().to_string();
            let is_command_block = code_lang.is_empty()
                || code_lang == "bash"
                || code_lang == "sh"
                || code_lang == "shell"
                || code_lang == "zsh";
            if is_command_block && !command.is_empty() {
                steps.push(SaveStepPayload {
                    title: if current_title.is_empty() {
                        format!("步骤 {}", steps.len() + 1)
                    } else {
                        current_title.clone()
                    },
                    command,
                    note: None,
                });
            }
            code_lang.clear();
            code_lines.clear();
            continue;
        }

        if in_code {
            code_lines.push(line.to_string());
        }
    }

    steps
}

fn build_markdown(title: &str, category: &str, problem: &str, steps: &[SaveStepPayload], seed_key: Option<&str>) -> String {
    let mut lines = Vec::new();
    lines.push("---".to_string());
    lines.push(format!("title: {title}"));
    lines.push(format!("category: {category}"));
    if let Some(key) = seed_key {
        lines.push(format!("seed_key: {key}"));
    }
    lines.push("---".to_string());
    lines.push(String::new());
    lines.push(format!("# {title}"));
    lines.push(String::new());
    lines.push("## 问题".to_string());
    if problem.trim().is_empty() {
        lines.push("（无）".to_string());
    } else {
        lines.push(problem.trim().to_string());
    }
    lines.push(String::new());
    lines.push("## 命令".to_string());
    lines.push(String::new());

    for (index, step) in steps.iter().enumerate() {
        let step_title = if step.title.trim().is_empty() {
            format!("{}. 命令", index + 1)
        } else {
            step.title.trim().to_string()
        };
        lines.push(format!("### {step_title}"));
        if let Some(note) = &step.note {
            if !note.trim().is_empty() {
                lines.push(note.trim().to_string());
                lines.push(String::new());
            }
        }
        lines.push("```bash".to_string());
        lines.push(step.command.trim().to_string());
        lines.push("```".to_string());
        lines.push(String::new());
    }

    lines.join("\n")
}

fn parse_markdown(
    content: &str,
    forced_seed_key: Option<String>,
    _source: &str,
) -> Result<ParsedRunbook, String> {
    let (meta, body) = parse_front_matter(content);
    let title = meta
        .get("title")
        .cloned()
        .or_else(|| {
            body.lines().find_map(|line| {
                let trimmed = line.trim();
                if trimmed.starts_with("# ") {
                    Some(trimmed.trim_start_matches('#').trim().to_string())
                } else {
                    None
                }
            })
        })
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Markdown missing title".to_string())?;

    let category = meta
        .get("category")
        .cloned()
        .unwrap_or_else(|| "通用".to_string());
    let seed_key = forced_seed_key.or_else(|| meta.get("seed_key").cloned());
    let problem = {
        let from_body = extract_problem(&body);
        if from_body.is_empty() {
            meta.get("problem").cloned().unwrap_or_default()
        } else {
            from_body
        }
    };
    let steps = extract_steps(&body);
    if steps.is_empty() {
        return Err("Markdown has no bash/shell command blocks".to_string());
    }

    let content_md = build_markdown(&title, &category, &problem, &steps, seed_key.as_deref());

    Ok(ParsedRunbook {
        seed_key,
        title,
        category,
        problem,
        content_md,
        steps,
    })
}

fn insert_runbook(
    connection: &Connection,
    parsed: &ParsedRunbook,
    source: &str,
) -> Result<i64, String> {
    let timestamp = now_ms() as i64;
    connection
        .execute(
            "INSERT INTO command_runbooks
             (seed_key, title, category, problem, content_md, source, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                parsed.seed_key,
                parsed.title,
                parsed.category,
                parsed.problem,
                parsed.content_md,
                source,
                timestamp,
                timestamp
            ],
        )
        .map_err(|error| error.to_string())?;

    let runbook_id = connection.last_insert_rowid();
    replace_steps(connection, runbook_id, &parsed.steps)?;
    Ok(runbook_id)
}

fn replace_steps(
    connection: &Connection,
    runbook_id: i64,
    steps: &[SaveStepPayload],
) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM command_steps WHERE runbook_id = ?1",
            params![runbook_id],
        )
        .map_err(|error| error.to_string())?;

    for (index, step) in steps.iter().enumerate() {
        let command = step.command.trim();
        if command.is_empty() {
            continue;
        }
        connection
            .execute(
                "INSERT INTO command_steps (runbook_id, sort_order, title, command, note)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    runbook_id,
                    index as i64,
                    step.title.trim(),
                    command,
                    step.note.clone().unwrap_or_default()
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn map_summary_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CommandRunbookSummary> {
    Ok(CommandRunbookSummary {
        id: row.get(0)?,
        seed_key: row.get(1)?,
        title: row.get(2)?,
        category: row.get(3)?,
        problem: row.get(4)?,
        source: row.get(5)?,
        step_count: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn fetch_steps(connection: &Connection, runbook_id: i64) -> Result<Vec<CommandStep>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, runbook_id, sort_order, title, command, note
             FROM command_steps
             WHERE runbook_id = ?1
             ORDER BY sort_order ASC, id ASC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![runbook_id], |row| {
            Ok(CommandStep {
                id: row.get(0)?,
                runbook_id: row.get(1)?,
                sort_order: row.get(2)?,
                title: row.get(3)?,
                command: row.get(4)?,
                note: row.get(5)?,
            })
        })
        .map_err(|error| error.to_string())?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|error| error.to_string())?);
    }
    Ok(items)
}

fn fetch_runbook(connection: &Connection, id: i64) -> Result<CommandRunbook, String> {
    let mut runbook = connection
        .query_row(
            "SELECT id, seed_key, title, category, problem, content_md, source, created_at, updated_at
             FROM command_runbooks WHERE id = ?1",
            params![id],
            |row| {
                Ok(CommandRunbook {
                    id: row.get(0)?,
                    seed_key: row.get(1)?,
                    title: row.get(2)?,
                    category: row.get(3)?,
                    problem: row.get(4)?,
                    content_md: row.get(5)?,
                    source: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                    steps: Vec::new(),
                })
            },
        )
        .map_err(|error| error.to_string())?;

    runbook.steps = fetch_steps(connection, id)?;
    Ok(runbook)
}

#[tauri::command]
pub fn list_command_runbooks(
    state: State<'_, AppState>,
) -> Result<Vec<CommandRunbookSummary>, String> {
    let connection = create_connection(&state.db_path)?;
    let mut statement = connection
        .prepare(
            "SELECT r.id, r.seed_key, r.title, r.category, r.problem, r.source,
                    (SELECT COUNT(*) FROM command_steps s WHERE s.runbook_id = r.id) AS step_count,
                    r.updated_at
             FROM command_runbooks r
             ORDER BY
                CASE r.source WHEN 'builtin' THEN 0 ELSE 1 END,
                r.category ASC,
                r.title ASC,
                r.id ASC",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], map_summary_row)
        .map_err(|error| error.to_string())?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|error| error.to_string())?);
    }
    Ok(items)
}

#[tauri::command]
pub fn get_command_runbook(
    state: State<'_, AppState>,
    id: i64,
) -> Result<CommandRunbook, String> {
    let connection = create_connection(&state.db_path)?;
    fetch_runbook(&connection, id)
}

#[tauri::command]
pub fn save_command_runbook(
    state: State<'_, AppState>,
    payload: SaveRunbookPayload,
) -> Result<CommandRunbook, String> {
    let title = payload.title.trim();
    let category = payload.category.trim();
    if title.is_empty() {
        return Err("Title is required".to_string());
    }
    if category.is_empty() {
        return Err("Category is required".to_string());
    }
    if payload.steps.is_empty() {
        return Err("At least one command step is required".to_string());
    }

    let connection = create_connection(&state.db_path)?;
    let content_md = payload.content_md.clone().unwrap_or_else(|| {
        build_markdown(title, category, payload.problem.trim(), &payload.steps, None)
    });
    let timestamp = now_ms() as i64;

    let id = if let Some(existing_id) = payload.id {
        let source: String = connection
            .query_row(
                "SELECT source FROM command_runbooks WHERE id = ?1",
                params![existing_id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if source == "builtin" {
            // Allow editing builtins as user copies? Prefer forking: create user copy.
            // Spec: users can edit/add - allow update of content for user only.
            // For builtin, create a new user runbook instead of mutating seed.
            let parsed = ParsedRunbook {
                seed_key: None,
                title: format!("{title} (自定义)"),
                category: category.to_string(),
                problem: payload.problem.trim().to_string(),
                content_md: build_markdown(
                    &format!("{title} (自定义)"),
                    category,
                    payload.problem.trim(),
                    &payload.steps,
                    None,
                ),
                steps: payload.steps.clone(),
            };
            insert_runbook(&connection, &parsed, "user")?
        } else {
            connection
                .execute(
                    "UPDATE command_runbooks
                     SET title = ?1, category = ?2, problem = ?3, content_md = ?4, updated_at = ?5
                     WHERE id = ?6",
                    params![
                        title,
                        category,
                        payload.problem.trim(),
                        content_md,
                        timestamp,
                        existing_id
                    ],
                )
                .map_err(|error| error.to_string())?;
            replace_steps(&connection, existing_id, &payload.steps)?;
            existing_id
        }
    } else {
        let parsed = ParsedRunbook {
            seed_key: None,
            title: title.to_string(),
            category: category.to_string(),
            problem: payload.problem.trim().to_string(),
            content_md,
            steps: payload.steps.clone(),
        };
        insert_runbook(&connection, &parsed, "user")?
    };

    fetch_runbook(&connection, id)
}

#[tauri::command]
pub fn delete_command_runbook(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let connection = create_connection(&state.db_path)?;
    let source: String = connection
        .query_row(
            "SELECT source FROM command_runbooks WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if source == "builtin" {
        return Err("Builtin runbooks cannot be deleted".to_string());
    }

    connection
        .execute("DELETE FROM command_steps WHERE runbook_id = ?1", params![id])
        .map_err(|error| error.to_string())?;
    connection
        .execute("DELETE FROM command_runbooks WHERE id = ?1", params![id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn import_command_runbook_md(
    state: State<'_, AppState>,
    payload: ImportMarkdownPayload,
) -> Result<CommandRunbook, String> {
    let connection = create_connection(&state.db_path)?;
    let parsed = parse_markdown(&payload.content_md, None, "user")?;
    let mut parsed = parsed;
    parsed.seed_key = None;
    let id = insert_runbook(&connection, &parsed, "user")?;
    fetch_runbook(&connection, id)
}

#[tauri::command]
pub fn export_command_runbook_md(
    state: State<'_, AppState>,
    id: i64,
) -> Result<String, String> {
    let connection = create_connection(&state.db_path)?;
    let runbook = fetch_runbook(&connection, id)?;
    Ok(runbook.content_md)
}

#[tauri::command]
pub fn list_runbook_categories(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let connection = create_connection(&state.db_path)?;
    let mut statement = connection
        .prepare(
            "SELECT DISTINCT category FROM command_runbooks ORDER BY category ASC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|error| error.to_string())?);
    }
    Ok(items)
}
