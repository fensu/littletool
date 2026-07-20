use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

use crate::{create_connection, now_ms, AppState};

const INBOX_NAME: &str = "待办箱";
const DEFAULT_COLUMNS: [&str; 3] = ["待办", "进行中", "已完成"];

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TodoProject {
    pub id: i64,
    pub name: String,
    pub kind: String,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TodoColumn {
    pub id: i64,
    pub project_id: i64,
    pub title: String,
    pub sort_order: i64,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TodoTask {
    pub id: i64,
    pub project_id: i64,
    pub column_id: i64,
    pub title: String,
    pub notes: String,
    pub priority: String,
    pub start_at: Option<i64>,
    pub end_at: Option<i64>,
    pub sort_order: i64,
    pub completed_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub project_name: Option<String>,
    pub column_title: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TodoBoardColumn {
    pub column: TodoColumn,
    pub tasks: Vec<TodoTask>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TodoBoard {
    pub project: TodoProject,
    pub columns: Vec<TodoBoardColumn>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectPayload {
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameProjectPayload {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameColumnPayload {
    pub id: i64,
    pub title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateColumnPayload {
    pub project_id: i64,
    pub title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskPayload {
    pub project_id: i64,
    pub column_id: Option<i64>,
    pub title: String,
    pub notes: Option<String>,
    pub priority: Option<String>,
    pub start_at: Option<i64>,
    pub end_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskPayload {
    pub id: i64,
    pub title: Option<String>,
    pub notes: Option<String>,
    pub priority: Option<String>,
    pub start_at: Option<Option<i64>>,
    pub end_at: Option<Option<i64>>,
    pub project_id: Option<i64>,
    pub column_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveTaskPayload {
    pub id: i64,
    pub column_id: i64,
    pub sort_order: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodayTasksPayload {
    pub day_start_ms: i64,
    pub day_end_ms: i64,
}

pub fn init_todo_tables(db_path: &PathBuf) -> Result<(), String> {
    let connection = create_connection(db_path)?;
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS todo_projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'project',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS todo_columns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                FOREIGN KEY(project_id) REFERENCES todo_projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS todo_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                column_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                priority TEXT NOT NULL DEFAULT 'medium',
                start_at INTEGER,
                end_at INTEGER,
                sort_order INTEGER NOT NULL DEFAULT 0,
                completed_at INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY(project_id) REFERENCES todo_projects(id) ON DELETE CASCADE,
                FOREIGN KEY(column_id) REFERENCES todo_columns(id) ON DELETE CASCADE
            );
            ",
        )
        .map_err(|error| error.to_string())?;

    ensure_completed_at_column(&connection)?;
    ensure_inbox_project(&connection)?;
    Ok(())
}

fn ensure_completed_at_column(connection: &Connection) -> Result<(), String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(todo_tasks)")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?;

    let mut has_completed_at = false;
    for row in rows {
        let name = row.map_err(|error| error.to_string())?;
        if name == "completed_at" {
            has_completed_at = true;
            break;
        }
    }

    if !has_completed_at {
        connection
            .execute("ALTER TABLE todo_tasks ADD COLUMN completed_at INTEGER", [])
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn find_done_column_id(connection: &Connection, project_id: i64) -> Result<i64, String> {
    let by_title: Option<i64> = connection
        .query_row(
            "SELECT id FROM todo_columns
             WHERE project_id = ?1 AND (title = '已完成' OR lower(title) = 'done' OR title = '完成')
             ORDER BY sort_order ASC, id ASC LIMIT 1",
            params![project_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;

    if let Some(id) = by_title {
        return Ok(id);
    }

    connection
        .query_row(
            "SELECT id FROM todo_columns WHERE project_id = ?1 ORDER BY sort_order DESC, id DESC LIMIT 1",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}

fn find_open_column_id(connection: &Connection, project_id: i64) -> Result<i64, String> {
    connection
        .query_row(
            "SELECT id FROM todo_columns WHERE project_id = ?1 ORDER BY sort_order ASC, id ASC LIMIT 1",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}

fn ensure_inbox_project(connection: &Connection) -> Result<TodoProject, String> {
    let existing = connection
        .query_row(
            "SELECT id, name, kind, sort_order, created_at, updated_at
             FROM todo_projects WHERE kind = 'inbox' ORDER BY id ASC LIMIT 1",
            [],
            map_project_row,
        )
        .optional()
        .map_err(|error| error.to_string())?;

    if let Some(project) = existing {
        ensure_default_columns(connection, project.id)?;
        return Ok(project);
    }

    let timestamp = now_ms() as i64;
    connection
        .execute(
            "INSERT INTO todo_projects (name, kind, sort_order, created_at, updated_at)
             VALUES (?1, 'inbox', 0, ?2, ?3)",
            params![INBOX_NAME, timestamp, timestamp],
        )
        .map_err(|error| error.to_string())?;
    let id = connection.last_insert_rowid();
    ensure_default_columns(connection, id)?;
    fetch_project(connection, id)
}

fn ensure_default_columns(connection: &Connection, project_id: i64) -> Result<(), String> {
    let count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM todo_columns WHERE project_id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;

    if count > 0 {
        return Ok(());
    }

    let timestamp = now_ms() as i64;
    for (index, title) in DEFAULT_COLUMNS.iter().enumerate() {
        connection
            .execute(
                "INSERT INTO todo_columns (project_id, title, sort_order, created_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![project_id, *title, index as i64, timestamp],
            )
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn map_project_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TodoProject> {
    Ok(TodoProject {
        id: row.get(0)?,
        name: row.get(1)?,
        kind: row.get(2)?,
        sort_order: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn map_column_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TodoColumn> {
    Ok(TodoColumn {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        sort_order: row.get(3)?,
        created_at: row.get(4)?,
    })
}

fn map_task_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TodoTask> {
    Ok(TodoTask {
        id: row.get(0)?,
        project_id: row.get(1)?,
        column_id: row.get(2)?,
        title: row.get(3)?,
        notes: row.get(4)?,
        priority: row.get(5)?,
        start_at: row.get(6)?,
        end_at: row.get(7)?,
        sort_order: row.get(8)?,
        completed_at: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        project_name: row.get(12).ok(),
        column_title: row.get(13).ok(),
    })
}

fn fetch_project(connection: &Connection, id: i64) -> Result<TodoProject, String> {
    connection
        .query_row(
            "SELECT id, name, kind, sort_order, created_at, updated_at
             FROM todo_projects WHERE id = ?1",
            params![id],
            map_project_row,
        )
        .map_err(|error| error.to_string())
}

fn first_column_id(connection: &Connection, project_id: i64) -> Result<i64, String> {
    connection
        .query_row(
            "SELECT id FROM todo_columns WHERE project_id = ?1 ORDER BY sort_order ASC, id ASC LIMIT 1",
            params![project_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}

fn next_task_sort(connection: &Connection, column_id: i64) -> Result<i64, String> {
    let max: Option<i64> = connection
        .query_row(
            "SELECT MAX(sort_order) FROM todo_tasks WHERE column_id = ?1",
            params![column_id],
            |row| row.get::<_, Option<i64>>(0),
        )
        .map_err(|error| error.to_string())?;
    Ok(max.unwrap_or(-1) + 1)
}

fn fetch_task(connection: &Connection, id: i64) -> Result<TodoTask, String> {
    connection
        .query_row(
            "SELECT t.id, t.project_id, t.column_id, t.title, t.notes, t.priority,
                    t.start_at, t.end_at, t.sort_order, t.completed_at, t.created_at, t.updated_at,
                    p.name, c.title
             FROM todo_tasks t
             LEFT JOIN todo_projects p ON p.id = t.project_id
             LEFT JOIN todo_columns c ON c.id = t.column_id
             WHERE t.id = ?1",
            params![id],
            map_task_row,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_todo_projects(state: State<'_, AppState>) -> Result<Vec<TodoProject>, String> {
    let connection = create_connection(&state.db_path)?;
    ensure_inbox_project(&connection)?;

    let mut statement = connection
        .prepare(
            "SELECT id, name, kind, sort_order, created_at, updated_at
             FROM todo_projects
             ORDER BY CASE kind WHEN 'inbox' THEN 0 ELSE 1 END, sort_order ASC, id ASC",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], map_project_row)
        .map_err(|error| error.to_string())?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|error| error.to_string())?);
    }
    Ok(items)
}

#[tauri::command]
pub fn create_todo_project(
    state: State<'_, AppState>,
    payload: CreateProjectPayload,
) -> Result<TodoProject, String> {
    let name = payload.name.trim();
    if name.is_empty() {
        return Err("Project name is required".to_string());
    }

    let connection = create_connection(&state.db_path)?;
    let timestamp = now_ms() as i64;
    let sort_order: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM todo_projects WHERE kind = 'project'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(1);

    connection
        .execute(
            "INSERT INTO todo_projects (name, kind, sort_order, created_at, updated_at)
             VALUES (?1, 'project', ?2, ?3, ?4)",
            params![name, sort_order, timestamp, timestamp],
        )
        .map_err(|error| error.to_string())?;

    let id = connection.last_insert_rowid();
    ensure_default_columns(&connection, id)?;
    fetch_project(&connection, id)
}

#[tauri::command]
pub fn rename_todo_project(
    state: State<'_, AppState>,
    payload: RenameProjectPayload,
) -> Result<TodoProject, String> {
    let name = payload.name.trim();
    if name.is_empty() {
        return Err("Project name is required".to_string());
    }

    let connection = create_connection(&state.db_path)?;
    let project = fetch_project(&connection, payload.id)?;
    if project.kind == "inbox" {
        return Err("Inbox project cannot be renamed".to_string());
    }

    connection
        .execute(
            "UPDATE todo_projects SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now_ms() as i64, payload.id],
        )
        .map_err(|error| error.to_string())?;

    fetch_project(&connection, payload.id)
}

#[tauri::command]
pub fn delete_todo_project(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let connection = create_connection(&state.db_path)?;
    let project = fetch_project(&connection, id)?;
    if project.kind == "inbox" {
        return Err("Inbox project cannot be deleted".to_string());
    }

    connection
        .execute("DELETE FROM todo_tasks WHERE project_id = ?1", params![id])
        .map_err(|error| error.to_string())?;
    connection
        .execute("DELETE FROM todo_columns WHERE project_id = ?1", params![id])
        .map_err(|error| error.to_string())?;
    connection
        .execute("DELETE FROM todo_projects WHERE id = ?1", params![id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_todo_board(state: State<'_, AppState>, project_id: i64) -> Result<TodoBoard, String> {
    let connection = create_connection(&state.db_path)?;
    let project = fetch_project(&connection, project_id)?;
    ensure_default_columns(&connection, project_id)?;

    let mut column_statement = connection
        .prepare(
            "SELECT id, project_id, title, sort_order, created_at
             FROM todo_columns
             WHERE project_id = ?1
             ORDER BY sort_order ASC, id ASC",
        )
        .map_err(|error| error.to_string())?;

    let column_rows = column_statement
        .query_map(params![project_id], map_column_row)
        .map_err(|error| error.to_string())?;

    let mut columns = Vec::new();
    for column_row in column_rows {
        let column = column_row.map_err(|error| error.to_string())?;
        let mut task_statement = connection
            .prepare(
                "SELECT t.id, t.project_id, t.column_id, t.title, t.notes, t.priority,
                        t.start_at, t.end_at, t.sort_order, t.created_at, t.updated_at,
                        p.name, c.title
                 FROM todo_tasks t
                 LEFT JOIN todo_projects p ON p.id = t.project_id
                 LEFT JOIN todo_columns c ON c.id = t.column_id
                 WHERE t.column_id = ?1
                 ORDER BY t.sort_order ASC, t.id ASC",
            )
            .map_err(|error| error.to_string())?;

        let task_rows = task_statement
            .query_map(params![column.id], map_task_row)
            .map_err(|error| error.to_string())?;

        let mut tasks = Vec::new();
        for task_row in task_rows {
            tasks.push(task_row.map_err(|error| error.to_string())?);
        }

        columns.push(TodoBoardColumn { column, tasks });
    }

    Ok(TodoBoard { project, columns })
}

#[tauri::command]
pub fn rename_todo_column(
    state: State<'_, AppState>,
    payload: RenameColumnPayload,
) -> Result<TodoColumn, String> {
    let title = payload.title.trim();
    if title.is_empty() {
        return Err("Column title is required".to_string());
    }

    let connection = create_connection(&state.db_path)?;
    connection
        .execute(
            "UPDATE todo_columns SET title = ?1 WHERE id = ?2",
            params![title, payload.id],
        )
        .map_err(|error| error.to_string())?;

    connection
        .query_row(
            "SELECT id, project_id, title, sort_order, created_at FROM todo_columns WHERE id = ?1",
            params![payload.id],
            map_column_row,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_todo_column(
    state: State<'_, AppState>,
    payload: CreateColumnPayload,
) -> Result<TodoColumn, String> {
    let title = payload.title.trim();
    if title.is_empty() {
        return Err("Column title is required".to_string());
    }

    let connection = create_connection(&state.db_path)?;
    let _ = fetch_project(&connection, payload.project_id)?;
    let sort_order: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM todo_columns WHERE project_id = ?1",
            params![payload.project_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;

    let timestamp = now_ms() as i64;
    connection
        .execute(
            "INSERT INTO todo_columns (project_id, title, sort_order, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![payload.project_id, title, sort_order, timestamp],
        )
        .map_err(|error| error.to_string())?;

    let id = connection.last_insert_rowid();
    connection
        .query_row(
            "SELECT id, project_id, title, sort_order, created_at FROM todo_columns WHERE id = ?1",
            params![id],
            map_column_row,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_todo_task(
    state: State<'_, AppState>,
    payload: CreateTaskPayload,
) -> Result<TodoTask, String> {
    let title = payload.title.trim();
    if title.is_empty() {
        return Err("Task title is required".to_string());
    }

    let connection = create_connection(&state.db_path)?;
    let _ = fetch_project(&connection, payload.project_id)?;
    let column_id = match payload.column_id {
        Some(id) => id,
        None => first_column_id(&connection, payload.project_id)?,
    };
    let sort_order = next_task_sort(&connection, column_id)?;
    let timestamp = now_ms() as i64;
    let priority = payload
        .priority
        .as_deref()
        .unwrap_or("medium")
        .trim()
        .to_string();
    let notes = payload.notes.unwrap_or_default();

    connection
        .execute(
            "INSERT INTO todo_tasks
             (project_id, column_id, title, notes, priority, start_at, end_at, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                payload.project_id,
                column_id,
                title,
                notes,
                priority,
                payload.start_at,
                payload.end_at,
                sort_order,
                timestamp,
                timestamp
            ],
        )
        .map_err(|error| error.to_string())?;

    let id = connection.last_insert_rowid();
    fetch_task(&connection, id)
}

#[tauri::command]
pub fn update_todo_task(
    state: State<'_, AppState>,
    payload: UpdateTaskPayload,
) -> Result<TodoTask, String> {
    let connection = create_connection(&state.db_path)?;
    let current = fetch_task(&connection, payload.id)?;

    let title = payload
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(current.title.as_str())
        .to_string();
    let notes = payload.notes.unwrap_or(current.notes);
    let priority = payload
        .priority
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(current.priority.as_str())
        .to_string();
    let start_at = match payload.start_at {
        Some(value) => value,
        None => current.start_at,
    };
    let end_at = match payload.end_at {
        Some(value) => value,
        None => current.end_at,
    };
    let project_id = payload.project_id.unwrap_or(current.project_id);
    let column_id = payload.column_id.unwrap_or(current.column_id);

    connection
        .execute(
            "UPDATE todo_tasks
             SET project_id = ?1, column_id = ?2, title = ?3, notes = ?4, priority = ?5,
                 start_at = ?6, end_at = ?7, updated_at = ?8
             WHERE id = ?9",
            params![
                project_id,
                column_id,
                title,
                notes,
                priority,
                start_at,
                end_at,
                now_ms() as i64,
                payload.id
            ],
        )
        .map_err(|error| error.to_string())?;

    fetch_task(&connection, payload.id)
}

#[tauri::command]
pub fn move_todo_task(
    state: State<'_, AppState>,
    payload: MoveTaskPayload,
) -> Result<TodoTask, String> {
    let connection = create_connection(&state.db_path)?;
    let current = fetch_task(&connection, payload.id)?;
    let sort_order = match payload.sort_order {
        Some(value) => value,
        None => next_task_sort(&connection, payload.column_id)?,
    };

    // Keep project aligned with destination column.
    let project_id: i64 = connection
        .query_row(
            "SELECT project_id FROM todo_columns WHERE id = ?1",
            params![payload.column_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;

    let done_column_id = find_done_column_id(&connection, project_id)?;
    let timestamp = now_ms() as i64;
    let completed_at = if payload.column_id == done_column_id {
        Some(current.completed_at.unwrap_or(timestamp))
    } else {
        None
    };

    connection
        .execute(
            "UPDATE todo_tasks
             SET column_id = ?1, project_id = ?2, sort_order = ?3, completed_at = ?4, updated_at = ?5
             WHERE id = ?6",
            params![
                payload.column_id,
                project_id,
                sort_order,
                completed_at,
                timestamp,
                payload.id
            ],
        )
        .map_err(|error| error.to_string())?;

    fetch_task(&connection, payload.id)
}

#[tauri::command]
pub fn delete_todo_task(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let connection = create_connection(&state.db_path)?;
    connection
        .execute("DELETE FROM todo_tasks WHERE id = ?1", params![id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_today_tasks(
    state: State<'_, AppState>,
    payload: TodayTasksPayload,
) -> Result<Vec<TodoTask>, String> {
    let connection = create_connection(&state.db_path)?;
    let day_start = payload.day_start_ms;
    let day_end = payload.day_end_ms;

    let mut statement = connection
        .prepare(
            "SELECT t.id, t.project_id, t.column_id, t.title, t.notes, t.priority,
                    t.start_at, t.end_at, t.sort_order, t.completed_at, t.created_at, t.updated_at,
                    p.name, c.title
             FROM todo_tasks t
             LEFT JOIN todo_projects p ON p.id = t.project_id
             LEFT JOIN todo_columns c ON c.id = t.column_id
             WHERE t.completed_at IS NULL
               AND (
                -- due today (end_at falls in today)
                (t.end_at IS NOT NULL AND t.end_at >= ?1 AND t.end_at < ?2)
                OR
                -- range overlaps today
                (
                  t.start_at IS NOT NULL AND t.end_at IS NOT NULL
                  AND t.start_at < ?2 AND t.end_at >= ?1
                )
                OR
                -- only start_at on today
                (
                  t.start_at IS NOT NULL AND t.end_at IS NULL
                  AND t.start_at >= ?1 AND t.start_at < ?2
                )
               )
             ORDER BY
                CASE WHEN t.end_at IS NOT NULL THEN t.end_at ELSE t.start_at END ASC,
                t.sort_order ASC,
                t.id ASC",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map(params![day_start, day_end], map_task_row)
        .map_err(|error| error.to_string())?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|error| error.to_string())?);
    }
    Ok(items)
}

#[tauri::command]
pub fn complete_todo_task(state: State<'_, AppState>, id: i64) -> Result<TodoTask, String> {
    let connection = create_connection(&state.db_path)?;
    let current = fetch_task(&connection, id)?;
    let done_column_id = find_done_column_id(&connection, current.project_id)?;
    let sort_order = next_task_sort(&connection, done_column_id)?;
    let timestamp = now_ms() as i64;

    connection
        .execute(
            "UPDATE todo_tasks
             SET column_id = ?1, sort_order = ?2, completed_at = ?3, updated_at = ?4
             WHERE id = ?5",
            params![done_column_id, sort_order, timestamp, timestamp, id],
        )
        .map_err(|error| error.to_string())?;

    fetch_task(&connection, id)
}

#[tauri::command]
pub fn reopen_todo_task(state: State<'_, AppState>, id: i64) -> Result<TodoTask, String> {
    let connection = create_connection(&state.db_path)?;
    let current = fetch_task(&connection, id)?;
    let open_column_id = find_open_column_id(&connection, current.project_id)?;
    let sort_order = next_task_sort(&connection, open_column_id)?;
    let timestamp = now_ms() as i64;

    connection
        .execute(
            "UPDATE todo_tasks
             SET column_id = ?1, sort_order = ?2, completed_at = NULL, updated_at = ?3
             WHERE id = ?4",
            params![open_column_id, sort_order, timestamp, id],
        )
        .map_err(|error| error.to_string())?;

    fetch_task(&connection, id)
}

#[tauri::command]
pub fn list_completed_tasks(state: State<'_, AppState>) -> Result<Vec<TodoTask>, String> {
    let connection = create_connection(&state.db_path)?;
    let mut statement = connection
        .prepare(
            "SELECT t.id, t.project_id, t.column_id, t.title, t.notes, t.priority,
                    t.start_at, t.end_at, t.sort_order, t.completed_at, t.created_at, t.updated_at,
                    p.name, c.title
             FROM todo_tasks t
             LEFT JOIN todo_projects p ON p.id = t.project_id
             LEFT JOIN todo_columns c ON c.id = t.column_id
             WHERE t.completed_at IS NOT NULL
             ORDER BY t.completed_at DESC, t.id DESC",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], map_task_row)
        .map_err(|error| error.to_string())?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|error| error.to_string())?);
    }
    Ok(items)
}


