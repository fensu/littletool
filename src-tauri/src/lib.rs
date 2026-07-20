mod todo;
mod handbook;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use ssh2::Session;
use std::{
    collections::HashMap,
    fs,
    io::{ErrorKind, Read, Write},
    net::TcpStream,
    path::PathBuf,
    sync::{
        mpsc::{self, Sender, TryRecvError},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

const MAX_SNAPSHOT_CHARS: usize = 200_000;

#[derive(Clone)]
struct AppState {
    db_path: Arc<PathBuf>,
    sessions: Arc<Mutex<HashMap<i64, PersistentSessionHandle>>>,
}

#[derive(Clone)]
struct PersistentSessionHandle {
    sender: Sender<SessionCommand>,
    snapshot: Arc<Mutex<SshSessionSnapshot>>,
}

enum SessionCommand {
    Write(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SshConnectionRecord {
    id: i64,
    name: String,
    host: String,
    port: u16,
    username: String,
    password: String,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveSshConnectionPayload {
    id: Option<i64>,
    name: String,
    host: String,
    port: u16,
    username: String,
    password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunSshCommandPayload {
    connection_ids: Vec<i64>,
    command: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteSshStdinPayload {
    connection_id: i64,
    data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResizeSshPtyPayload {
    connection_id: i64,
    cols: u32,
    rows: u32,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SshSessionSnapshot {
    connection_id: i64,
    connected: bool,
    output: String,
    error: Option<String>,
    last_updated_ms: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SshOutputEvent {
    connection_id: i64,
    data: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SshStatusEvent {
    connection_id: i64,
    connected: bool,
    error: Option<String>,
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub(crate) fn create_connection(db_path: &PathBuf) -> Result<Connection, String> {
    Connection::open(db_path).map_err(|error| error.to_string())
}

fn init_db(db_path: &PathBuf) -> Result<(), String> {
    let connection = create_connection(db_path)?;
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS ssh_connections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                username TEXT NOT NULL,
                password TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ssh_command_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                command TEXT NOT NULL,
                target_ids_json TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            ",
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

fn map_connection_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SshConnectionRecord> {
    Ok(SshConnectionRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        host: row.get(2)?,
        port: row.get(3)?,
        username: row.get(4)?,
        password: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn fetch_connection_by_id(db_path: &PathBuf, id: i64) -> Result<SshConnectionRecord, String> {
    let connection = create_connection(db_path)?;
    connection
        .query_row(
            "SELECT id, name, host, port, username, password, created_at, updated_at
             FROM ssh_connections WHERE id = ?1",
            params![id],
            map_connection_row,
        )
        .map_err(|error| error.to_string())
}

fn create_authenticated_session(record: &SshConnectionRecord) -> Result<Session, String> {
    let endpoint = format!("{}:{}", record.host, record.port);
    let tcp = TcpStream::connect((record.host.as_str(), record.port)).map_err(|error| {
        format!("TCP connect failed ({endpoint}): {error}")
    })?;
    // Prefer libssh2 session timeout over OS socket timeouts so later
    // non-blocking reads are not stalled by a long TCP read timeout.
    tcp.set_read_timeout(None)
        .map_err(|error| format!("Clear read timeout failed: {error}"))?;
    tcp.set_write_timeout(None)
        .map_err(|error| format!("Clear write timeout failed: {error}"))?;
    tcp.set_nodelay(true)
        .map_err(|error| format!("Set TCP nodelay failed: {error}"))?;

    let mut session = Session::new().map_err(|error| format!("Create SSH session failed: {error}"))?;
    session.set_tcp_stream(tcp);
    // Milliseconds. Used while still in blocking mode for handshake/auth/shell setup.
    session.set_timeout(30_000);
    session
        .handshake()
        .map_err(|error| format!("SSH handshake failed ({endpoint}): {error}"))?;
    session
        .userauth_password(&record.username, &record.password)
        .map_err(|error| {
            format!(
                "SSH password auth failed ({}@{}): {error}",
                record.username, endpoint
            )
        })?;

    if !session.authenticated() {
        return Err(format!(
            "SSH authentication rejected ({}@{})",
            record.username, endpoint
        ));
    }

    Ok(session)
}

fn trim_snapshot_output(output: &mut String) {
    if output.len() > MAX_SNAPSHOT_CHARS {
        let keep_from = output.len() - MAX_SNAPSHOT_CHARS;
        let trimmed = output.split_off(keep_from);
        *output = trimmed;
    }
}

fn append_snapshot_and_emit(
    app: &AppHandle,
    snapshot: &Arc<Mutex<SshSessionSnapshot>>,
    connection_id: i64,
    content: &str,
) {
    if content.is_empty() {
        return;
    }

    if let Ok(mut guard) = snapshot.lock() {
        guard.output.push_str(content);
        trim_snapshot_output(&mut guard.output);
        guard.last_updated_ms = now_ms();
    }

    let _ = app.emit(
        "ssh-output",
        SshOutputEvent {
            connection_id,
            data: content.to_string(),
        },
    );
}

fn set_disconnected(
    app: &AppHandle,
    snapshot: &Arc<Mutex<SshSessionSnapshot>>,
    connection_id: i64,
    error: Option<String>,
) {
    if let Ok(mut guard) = snapshot.lock() {
        guard.connected = false;
        guard.error = error.clone();
        guard.last_updated_ms = now_ms();
    }

    let _ = app.emit(
        "ssh-status",
        SshStatusEvent {
            connection_id,
            connected: false,
            error,
        },
    );
}

fn read_available<R: Read>(reader: &mut R) -> Result<String, String> {
    let mut combined = String::new();
    let mut buffer = [0u8; 8192];

    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(size) => combined.push_str(&String::from_utf8_lossy(&buffer[..size])),
            Err(error) if error.kind() == ErrorKind::WouldBlock || error.kind() == ErrorKind::TimedOut => {
                break
            }
            Err(error) => return Err(error.to_string()),
        }
    }

    Ok(combined)
}

fn spawn_persistent_session(
    app: AppHandle,
    record: SshConnectionRecord,
) -> Result<PersistentSessionHandle, String> {
    let connection_id = record.id;
    let session = create_authenticated_session(&record)?;

    // Important: open shell while still in blocking mode. Switching to
    // non-blocking before request_pty/shell often fails on Windows/libssh2.
    let mut channel = session
        .channel_session()
        .map_err(|error| format!("Open SSH channel failed: {error}"))?;
    channel
        .request_pty("xterm-256color", None, Some((120, 36, 0, 0)))
        .map_err(|error| format!("Request PTY failed: {error}"))?;
    channel
        .shell()
        .map_err(|error| format!("Start remote shell failed: {error}"))?;

    // Now switch to non-blocking for interactive streaming.
    session
        .set_blocking(false);
    let _ = session.set_timeout(0);

    let greeting = format!(
        "\r\n\x1b[32m# Connected to {}@{}:{}\x1b[0m\r\n",
        record.username, record.host, record.port
    );

    let snapshot = Arc::new(Mutex::new(SshSessionSnapshot {
        connection_id,
        connected: true,
        output: greeting.clone(),
        error: None,
        last_updated_ms: now_ms(),
    }));

    let _ = app.emit(
        "ssh-status",
        SshStatusEvent {
            connection_id,
            connected: true,
            error: None,
        },
    );

    let (sender, receiver) = mpsc::channel::<SessionCommand>();
    let snapshot_for_thread = Arc::clone(&snapshot);
    let app_for_thread = app.clone();

    thread::spawn(move || {
        // Keep session alive for the channel lifetime.
        let _session = session;

        loop {
            let mut idle = true;

            loop {
                match receiver.try_recv() {
                    Ok(SessionCommand::Write(bytes)) => {
                        idle = false;
                        if let Err(error) = channel.write_all(&bytes) {
                            set_disconnected(
                                &app_for_thread,
                                &snapshot_for_thread,
                                connection_id,
                                Some(error.to_string()),
                            );
                            return;
                        }
                        if let Err(error) = channel.flush() {
                            set_disconnected(
                                &app_for_thread,
                                &snapshot_for_thread,
                                connection_id,
                                Some(error.to_string()),
                            );
                            return;
                        }
                    }
                    Ok(SessionCommand::Resize { cols, rows }) => {
                        idle = false;
                        let safe_cols = cols.max(20);
                        let safe_rows = rows.max(5);
                        if let Err(error) =
                            channel.request_pty_size(safe_cols, safe_rows, None, None)
                        {
                            set_disconnected(
                                &app_for_thread,
                                &snapshot_for_thread,
                                connection_id,
                                Some(error.to_string()),
                            );
                            return;
                        }
                    }
                    Ok(SessionCommand::Close) => {
                        let _ = channel.close();
                        set_disconnected(&app_for_thread, &snapshot_for_thread, connection_id, None);
                        return;
                    }
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => {
                        let _ = channel.close();
                        set_disconnected(&app_for_thread, &snapshot_for_thread, connection_id, None);
                        return;
                    }
                }
            }

            match read_available(&mut channel) {
                Ok(output) if !output.is_empty() => {
                    idle = false;
                    append_snapshot_and_emit(
                        &app_for_thread,
                        &snapshot_for_thread,
                        connection_id,
                        &output,
                    );
                }
                Ok(_) => {}
                Err(error) => {
                    set_disconnected(
                        &app_for_thread,
                        &snapshot_for_thread,
                        connection_id,
                        Some(error),
                    );
                    return;
                }
            }

            {
                let mut stderr_stream = channel.stderr();
                match read_available(&mut stderr_stream) {
                    Ok(output) if !output.is_empty() => {
                        idle = false;
                        append_snapshot_and_emit(
                            &app_for_thread,
                            &snapshot_for_thread,
                            connection_id,
                            &output,
                        );
                    }
                    Ok(_) => {}
                    Err(error) => {
                        set_disconnected(
                            &app_for_thread,
                            &snapshot_for_thread,
                            connection_id,
                            Some(error),
                        );
                        return;
                    }
                }
            }

            if channel.eof() {
                set_disconnected(&app_for_thread, &snapshot_for_thread, connection_id, None);
                return;
            }

            if idle {
                thread::sleep(Duration::from_millis(16));
            }
        }
    });

    Ok(PersistentSessionHandle { sender, snapshot })
}

#[tauri::command]
fn list_ssh_connections(state: State<'_, AppState>) -> Result<Vec<SshConnectionRecord>, String> {
    let connection = create_connection(&state.db_path)?;
    let mut statement = connection
        .prepare(
            "SELECT id, name, host, port, username, password, created_at, updated_at
             FROM ssh_connections ORDER BY updated_at DESC, id DESC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], map_connection_row)
        .map_err(|error| error.to_string())?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|error| error.to_string())?);
    }
    Ok(items)
}

#[tauri::command]
fn save_ssh_connection(
    state: State<'_, AppState>,
    payload: SaveSshConnectionPayload,
) -> Result<SshConnectionRecord, String> {
    let connection = create_connection(&state.db_path)?;
    let timestamp = now_ms() as i64;

    if let Some(id) = payload.id {
        connection
            .execute(
                "UPDATE ssh_connections
                 SET name = ?1, host = ?2, port = ?3, username = ?4, password = ?5, updated_at = ?6
                 WHERE id = ?7",
                params![
                    payload.name,
                    payload.host,
                    payload.port,
                    payload.username,
                    payload.password,
                    timestamp,
                    id
                ],
            )
            .map_err(|error| error.to_string())?;

        if let Ok(mut sessions) = state.sessions.lock() {
            if let Some(handle) = sessions.remove(&id) {
                let _ = handle.sender.send(SessionCommand::Close);
            }
        }

        return fetch_connection_by_id(&state.db_path, id);
    }

    connection
        .execute(
            "INSERT INTO ssh_connections (name, host, port, username, password, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                payload.name,
                payload.host,
                payload.port,
                payload.username,
                payload.password,
                timestamp,
                timestamp
            ],
        )
        .map_err(|error| error.to_string())?;

    let inserted_id = connection.last_insert_rowid();
    fetch_connection_by_id(&state.db_path, inserted_id)
}

#[tauri::command]
fn delete_ssh_connection(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    if let Ok(mut sessions) = state.sessions.lock() {
        if let Some(handle) = sessions.remove(&id) {
            let _ = handle.sender.send(SessionCommand::Close);
        }
    }

    let connection = create_connection(&state.db_path)?;
    connection
        .execute("DELETE FROM ssh_connections WHERE id = ?1", params![id])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_ssh_session(app: AppHandle, state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let record = fetch_connection_by_id(&state.db_path, id)
        .map_err(|error| format!("Load connection #{id} failed: {error}"))?;

    let mut sessions = state
        .sessions
        .lock()
        .map_err(|error| format!("Session state lock failed: {error}"))?;

    if let Some(handle) = sessions.remove(&id) {
        let _ = handle.sender.send(SessionCommand::Close);
    }

    let handle = spawn_persistent_session(app, record)?;
    sessions.insert(id, handle);
    Ok(())
}

#[tauri::command]
fn close_ssh_session(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    if let Ok(mut sessions) = state.sessions.lock() {
        if let Some(handle) = sessions.remove(&id) {
            let _ = handle.sender.send(SessionCommand::Close);
        }
    }

    Ok(())
}

#[tauri::command]
fn list_ssh_session_snapshots(
    state: State<'_, AppState>,
) -> Result<Vec<SshSessionSnapshot>, String> {
    let sessions = state.sessions.lock().map_err(|error| error.to_string())?;
    let snapshots = sessions
        .values()
        .filter_map(|handle| handle.snapshot.lock().ok().map(|snapshot| snapshot.clone()))
        .collect::<Vec<_>>();

    Ok(snapshots)
}

#[tauri::command]
fn write_ssh_stdin(state: State<'_, AppState>, payload: WriteSshStdinPayload) -> Result<(), String> {
    let sessions = state.sessions.lock().map_err(|error| error.to_string())?;
    let handle = sessions
        .get(&payload.connection_id)
        .ok_or_else(|| format!("SSH session not ready: {}", payload.connection_id))?;

    handle
        .sender
        .send(SessionCommand::Write(payload.data.into_bytes()))
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
fn resize_ssh_pty(state: State<'_, AppState>, payload: ResizeSshPtyPayload) -> Result<(), String> {
    let sessions = state.sessions.lock().map_err(|error| error.to_string())?;
    let handle = sessions
        .get(&payload.connection_id)
        .ok_or_else(|| format!("SSH session not ready: {}", payload.connection_id))?;

    handle
        .sender
        .send(SessionCommand::Resize {
            cols: payload.cols,
            rows: payload.rows,
        })
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
fn run_ssh_command(state: State<'_, AppState>, payload: RunSshCommandPayload) -> Result<(), String> {
    let connection = create_connection(&state.db_path)?;
    connection
        .execute(
            "INSERT INTO ssh_command_history (command, target_ids_json, created_at)
             VALUES (?1, ?2, ?3)",
            params![
                payload.command,
                serde_json::to_string(&payload.connection_ids).map_err(|error| error.to_string())?,
                now_ms() as i64
            ],
        )
        .map_err(|error| error.to_string())?;

    let sessions = state.sessions.lock().map_err(|error| error.to_string())?;
    let bytes = format!("{}\n", payload.command).into_bytes();

    for connection_id in payload.connection_ids {
        let handle = sessions
            .get(&connection_id)
            .ok_or_else(|| format!("SSH session not ready: {connection_id}"))?;
        handle
            .sender
            .send(SessionCommand::Write(bytes.clone()))
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
            fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
            let db_path = app_data_dir.join("littletool.sqlite");
            init_db(&db_path)?;
            todo::init_todo_tables(&db_path)?;
            handbook::init_handbook_tables(&db_path)?;
            app.manage(AppState {
                db_path: Arc::new(db_path),
                sessions: Arc::new(Mutex::new(HashMap::new())),
            });
            Ok(())
        })
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_ssh_connections,
            save_ssh_connection,
            delete_ssh_connection,
            open_ssh_session,
            close_ssh_session,
            list_ssh_session_snapshots,
            write_ssh_stdin,
            resize_ssh_pty,
            run_ssh_command,
            todo::list_todo_projects,
            todo::create_todo_project,
            todo::rename_todo_project,
            todo::delete_todo_project,
            todo::get_todo_board,
            todo::rename_todo_column,
            todo::create_todo_column,
            todo::create_todo_task,
            todo::update_todo_task,
            todo::move_todo_task,
            todo::delete_todo_task,
            todo::list_today_tasks,
            todo::complete_todo_task,
            todo::reopen_todo_task,
            todo::list_completed_tasks,
            handbook::list_command_runbooks,
            handbook::get_command_runbook,
            handbook::save_command_runbook,
            handbook::delete_command_runbook,
            handbook::import_command_runbook_md,
            handbook::export_command_runbook_md,
            handbook::list_runbook_categories
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}






