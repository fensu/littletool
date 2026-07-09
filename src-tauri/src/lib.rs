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
use tauri::{Manager, State};

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
    Run(String),
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

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SshSessionSnapshot {
    connection_id: i64,
    connected: bool,
    output: String,
    error: Option<String>,
    last_updated_ms: u64,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn create_connection(db_path: &PathBuf) -> Result<Connection, String> {
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
    let tcp = TcpStream::connect((record.host.as_str(), record.port)).map_err(|error| error.to_string())?;
    tcp.set_read_timeout(Some(Duration::from_secs(30)))
        .map_err(|error| error.to_string())?;
    tcp.set_write_timeout(Some(Duration::from_secs(30)))
        .map_err(|error| error.to_string())?;

    let mut session = Session::new().map_err(|error| error.to_string())?;
    session.set_tcp_stream(tcp);
    session.handshake().map_err(|error| error.to_string())?;
    session
        .userauth_password(&record.username, &record.password)
        .map_err(|error| error.to_string())?;

    if !session.authenticated() {
        return Err("SSH authentication failed".to_string());
    }

    Ok(session)
}

fn append_snapshot(snapshot: &Arc<Mutex<SshSessionSnapshot>>, content: &str) {
    if content.is_empty() {
        return;
    }

    if let Ok(mut guard) = snapshot.lock() {
        guard.output.push_str(content);
        guard.last_updated_ms = now_ms();
    }
}

fn set_snapshot_error(snapshot: &Arc<Mutex<SshSessionSnapshot>>, message: String) {
    if let Ok(mut guard) = snapshot.lock() {
        guard.connected = false;
        guard.error = Some(message);
        guard.last_updated_ms = now_ms();
    }
}

fn read_available<R: Read>(reader: &mut R) -> Result<String, String> {
    let mut combined = String::new();
    let mut buffer = [0u8; 4096];

    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(size) => combined.push_str(&String::from_utf8_lossy(&buffer[..size])),
            Err(error) if error.kind() == ErrorKind::WouldBlock => break,
            Err(error) => return Err(error.to_string()),
        }
    }

    Ok(combined)
}

fn spawn_persistent_session(record: SshConnectionRecord) -> Result<PersistentSessionHandle, String> {
    let session = create_authenticated_session(&record)?;
    session.set_blocking(false);
    let mut channel = session.channel_session().map_err(|error| error.to_string())?;
    channel
        .request_pty("xterm", None, Some((120, 40, 0, 0)))
        .map_err(|error| error.to_string())?;
    channel.shell().map_err(|error| error.to_string())?;

    let snapshot = Arc::new(Mutex::new(SshSessionSnapshot {
        connection_id: record.id,
        connected: true,
        output: format!(
            "# Connected to {}@{}:{}\n",
            record.username, record.host, record.port
        ),
        error: None,
        last_updated_ms: now_ms(),
    }));

    let (sender, receiver) = mpsc::channel::<SessionCommand>();
    let snapshot_for_thread = Arc::clone(&snapshot);

    thread::spawn(move || {
        loop {
            let mut idle = true;

            loop {
                match receiver.try_recv() {
                    Ok(SessionCommand::Run(command)) => {
                        idle = false;
                        append_snapshot(&snapshot_for_thread, &format!("\n$ {}\n", command));

                        if let Err(error) = channel.write_all(format!("{command}\n").as_bytes()) {
                            set_snapshot_error(&snapshot_for_thread, error.to_string());
                            return;
                        }

                        if let Err(error) = channel.flush() {
                            set_snapshot_error(&snapshot_for_thread, error.to_string());
                            return;
                        }
                    }
                    Ok(SessionCommand::Close) => {
                        let _ = channel.close();
                        if let Ok(mut guard) = snapshot_for_thread.lock() {
                            guard.connected = false;
                            guard.last_updated_ms = now_ms();
                        }
                        return;
                    }
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => return,
                }
            }

            match read_available(&mut channel) {
                Ok(output) if !output.is_empty() => {
                    idle = false;
                    append_snapshot(&snapshot_for_thread, &output);
                }
                Ok(_) => {}
                Err(error) => {
                    set_snapshot_error(&snapshot_for_thread, error);
                    return;
                }
            }

            {
                let mut stderr_stream = channel.stderr();
                match read_available(&mut stderr_stream) {
                    Ok(output) if !output.is_empty() => {
                        idle = false;
                        append_snapshot(&snapshot_for_thread, &output);
                    }
                    Ok(_) => {}
                    Err(error) => {
                        set_snapshot_error(&snapshot_for_thread, error);
                        return;
                    }
                }
            }

            if channel.eof() {
                if let Ok(mut guard) = snapshot_for_thread.lock() {
                    guard.connected = false;
                    guard.last_updated_ms = now_ms();
                }
                return;
            }

            if idle {
                thread::sleep(Duration::from_millis(60));
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

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
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
fn open_ssh_session(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let record = fetch_connection_by_id(&state.db_path, id)?;

    if let Ok(mut sessions) = state.sessions.lock() {
        if let Some(handle) = sessions.remove(&id) {
            let _ = handle.sender.send(SessionCommand::Close);
        }

        let handle = spawn_persistent_session(record)?;
        sessions.insert(id, handle);
    }

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
fn list_ssh_session_snapshots(state: State<'_, AppState>) -> Result<Vec<SshSessionSnapshot>, String> {
    let sessions = state.sessions.lock().map_err(|error| error.to_string())?;
    let snapshots = sessions
        .values()
        .filter_map(|handle| handle.snapshot.lock().ok().map(|snapshot| snapshot.clone()))
        .collect::<Vec<_>>();

    Ok(snapshots)
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
    for connection_id in payload.connection_ids {
        let handle = sessions
            .get(&connection_id)
            .ok_or_else(|| format!("SSH session not ready: {connection_id}"))?;
        handle
            .sender
            .send(SessionCommand::Run(payload.command.clone()))
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
            run_ssh_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
