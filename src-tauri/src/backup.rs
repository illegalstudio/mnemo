use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

#[derive(Debug, Serialize)]
pub struct Snapshot {
    pub filename: String,
    pub path: String,
    pub size_bytes: u64,
    pub created_at: u64,
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(data_dir.join("mnemo.db"))
}

fn epoch_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[tauri::command]
pub async fn create_snapshot(app: AppHandle) -> Result<(), String> {
    let source = db_path(&app)?;
    if !source.exists() {
        return Err("Database file not found.".to_string());
    }
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let snapshot_name = format!("snapshot-{}.db", epoch_secs());
    fs::copy(&source, data_dir.join(&snapshot_name))
        .map_err(|e| format!("Failed to create snapshot: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn list_snapshots(app: AppHandle) -> Result<Vec<Snapshot>, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut snapshots = Vec::new();

    let entries = match fs::read_dir(&data_dir) {
        Ok(e) => e,
        Err(_) => return Ok(snapshots),
    };

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let filename = entry.file_name().to_string_lossy().to_string();
        if filename.starts_with("snapshot-") && filename.ends_with(".db") {
            let meta = entry.metadata().map_err(|e| e.to_string())?;
            let created_secs = filename
                .trim_start_matches("snapshot-")
                .trim_end_matches(".db")
                .parse::<u64>()
                .unwrap_or(0);

            snapshots.push(Snapshot {
                filename: filename.clone(),
                path: entry.path().to_string_lossy().to_string(),
                size_bytes: meta.len(),
                created_at: created_secs,
            });
        }
    }

    snapshots.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(snapshots)
}

#[tauri::command]
pub async fn export_snapshot(app: AppHandle, filename: String, dest_path: String) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = data_dir.join(&filename);
    if !path.exists() {
        return Err("Snapshot not found.".to_string());
    }
    let fname = path.file_name().unwrap_or_default().to_string_lossy();
    if !fname.starts_with("snapshot-") || !fname.ends_with(".db") {
        return Err("Invalid snapshot filename.".to_string());
    }
    fs::copy(&path, &dest_path).map_err(|e| format!("Failed to export: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn restore_snapshot(app: AppHandle, source_path: String) -> Result<(), String> {
    let source = PathBuf::from(&source_path);
    if !source.exists() {
        return Err("Snapshot file not found.".to_string());
    }

    let db_file = db_path(&app)?;

    // Safety: save current DB as snapshot before restoring
    if db_file.exists() {
        let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let safety_name = format!("snapshot-{}.db", epoch_secs());
        fs::copy(&db_file, data_dir.join(&safety_name))
            .map_err(|e| format!("Failed to create safety snapshot: {}", e))?;
    }

    fs::copy(&source, &db_file)
        .map_err(|e| format!("Failed to restore: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn delete_snapshot(app: AppHandle, filename: String) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = data_dir.join(&filename);
    if !path.exists() {
        return Err("Snapshot not found.".to_string());
    }
    let fname = path.file_name().unwrap_or_default().to_string_lossy();
    if !fname.starts_with("snapshot-") || !fname.ends_with(".db") {
        return Err("Invalid snapshot filename.".to_string());
    }
    fs::remove_file(&path).map_err(|e| format!("Failed to delete: {}", e))?;
    Ok(())
}
