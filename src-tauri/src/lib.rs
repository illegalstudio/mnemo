mod backup;
mod search;

use search::SearchIndex;
use serde::Deserialize;
use tauri::Manager;

#[tauri::command]
fn search_chats(query: String, state: tauri::State<'_, SearchIndex>) -> Result<Vec<String>, String> {
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
        .map(|c| {
            (
                c.id,
                c.title,
                c.summary.unwrap_or_default(),
                c.content_md,
            )
        })
        .collect();
    state.reindex_all(&docs).map_err(|e| e.to_string())
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
