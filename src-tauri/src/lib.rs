mod backup;
mod search;

use search::SearchIndex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command as ProcessCommand;
use tauri::Manager;

#[tauri::command]
fn search_chats(
    query: String,
    state: tauri::State<'_, SearchIndex>,
) -> Result<Vec<String>, String> {
    state.search(&query, 50).map_err(|e| e.to_string())
}

#[tauri::command]
fn index_chat(
    id: String,
    title: String,
    summary: String,
    content_md: String,
    state: tauri::State<'_, SearchIndex>,
) -> Result<(), String> {
    state
        .add_document(&id, &title, &summary, &content_md)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_from_index(id: String, state: tauri::State<'_, SearchIndex>) -> Result<(), String> {
    state.delete_document(&id).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatData {
    id: String,
    title: String,
    summary: Option<String>,
    content_md: String,
}

#[tauri::command]
fn reindex_all(chats: Vec<ChatData>, state: tauri::State<'_, SearchIndex>) -> Result<(), String> {
    let docs: Vec<(String, String, String, String)> = chats
        .into_iter()
        .map(|c| (c.id, c.title, c.summary.unwrap_or_default(), c.content_md))
        .collect();
    state.reindex_all(&docs).map_err(|e| e.to_string())
}

#[tauri::command]
fn search_index_count(state: tauri::State<'_, SearchIndex>) -> Result<u64, String> {
    Ok(state.doc_count())
}

#[derive(serde::Serialize)]
struct StorageUsage {
    db_bytes: u64,
    attachments_bytes: u64,
    attachments_count: u64,
}

#[tauri::command]
fn get_storage_usage(app: tauri::AppHandle) -> Result<StorageUsage, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let db_bytes = std::fs::metadata(data_dir.join("mnemo.db"))
        .map(|m| m.len())
        .unwrap_or(0);

    let mut attachments_bytes: u64 = 0;
    let mut attachments_count: u64 = 0;
    let att_dir = data_dir.join("attachments");
    if att_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&att_dir) {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    if meta.is_file() {
                        attachments_bytes += meta.len();
                        attachments_count += 1;
                    }
                }
            }
        }
    }

    Ok(StorageUsage {
        db_bytes,
        attachments_bytes,
        attachments_count,
    })
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum AnalysisTool {
    ClaudeCode,
    Codex,
}

#[derive(Serialize)]
struct AnalysisToolOutput {
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

fn default_analysis_binary(tool: AnalysisTool) -> &'static str {
    match tool {
        AnalysisTool::ClaudeCode => "claude",
        AnalysisTool::Codex => "codex",
    }
}

fn resolve_analysis_binary(tool: AnalysisTool, binary_path: Option<String>) -> String {
    binary_path
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
        .unwrap_or_else(|| default_analysis_binary(tool).to_string())
}

fn path_env_for_binary(binary: &str) -> Option<std::ffi::OsString> {
    let mut paths: Vec<PathBuf> = Vec::new();
    let binary_path = Path::new(binary);

    if binary_path.components().count() > 1 {
        if let Some(parent) = binary_path.parent() {
            if !parent.as_os_str().is_empty() {
                paths.push(parent.to_path_buf());
            }
        }
    }

    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        paths.push(home.join(".local/bin"));
        paths.push(home.join(".bun/bin"));
        paths.push(home.join(".cargo/bin"));
    }

    paths.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
        PathBuf::from("/usr/sbin"),
        PathBuf::from("/sbin"),
    ]);

    if let Some(current_path) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&current_path));
    }

    std::env::join_paths(paths).ok()
}

fn analysis_args(tool: AnalysisTool, prompt: String) -> Vec<String> {
    match tool {
        AnalysisTool::ClaudeCode => vec![
            "-p".to_string(),
            prompt,
            "--output-format".to_string(),
            "json".to_string(),
        ],
        AnalysisTool::Codex => vec![
            "--ask-for-approval".to_string(),
            "never".to_string(),
            "exec".to_string(),
            "--skip-git-repo-check".to_string(),
            "--sandbox".to_string(),
            "read-only".to_string(),
            "--color".to_string(),
            "never".to_string(),
            "--ephemeral".to_string(),
            prompt,
        ],
    }
}

fn process_command(binary: &str) -> ProcessCommand {
    let mut command = ProcessCommand::new(binary);
    if let Some(path_env) = path_env_for_binary(binary) {
        command.env("PATH", path_env);
    }
    command
}

#[tauri::command]
async fn check_analysis_tool(
    tool: AnalysisTool,
    binary_path: Option<String>,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let binary = resolve_analysis_binary(tool, binary_path);
        let output = process_command(&binary).arg("--version").output();
        Ok(output
            .map(|output| output.status.success())
            .unwrap_or(false))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn run_analysis_tool(
    tool: AnalysisTool,
    binary_path: Option<String>,
    prompt: String,
) -> Result<AnalysisToolOutput, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let binary = resolve_analysis_binary(tool, binary_path);
        let output = process_command(&binary)
            .args(analysis_args(tool, prompt))
            .output()
            .map_err(|e| e.to_string())?;

        Ok(AnalysisToolOutput {
            code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            search_chats,
            index_chat,
            delete_from_index,
            reindex_all,
            search_index_count,
            get_storage_usage,
            check_analysis_tool,
            run_analysis_tool,
            backup::create_snapshot,
            backup::list_snapshots,
            backup::export_snapshot,
            backup::restore_snapshot,
            backup::delete_snapshot,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Initialize Tantivy search index
            let app_data = app.path().app_data_dir()?;
            let index_path = app_data.join("tantivy_index");
            match SearchIndex::new(&index_path) {
                Ok(search_index) => {
                    log::info!("Tantivy index initialized at {:?}", index_path);
                    app.manage(search_index);
                }
                Err(e) => {
                    log::error!("Failed to initialize Tantivy index: {}", e);
                    // Try to recover by deleting and recreating
                    let _ = std::fs::remove_dir_all(&index_path);
                    let search_index = SearchIndex::new(&index_path)
                        .expect("Failed to create fresh Tantivy index");
                    app.manage(search_index);
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
