use serde::Serialize;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;
use zip::write::SimpleFileOptions;
use zip::ZipArchive;
use zip::ZipWriter;

const DB_NAME_IN_ZIP: &str = "mnemo.db";

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

fn compress_db_to_zip(db_file: &PathBuf, zip_path: &PathBuf) -> Result<(), String> {
    let db_data = fs::read(db_file).map_err(|e| format!("Failed to read database: {}", e))?;
    let zip_file =
        File::create(zip_path).map_err(|e| format!("Failed to create zip file: {}", e))?;
    let mut zip = ZipWriter::new(zip_file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .compression_level(Some(6));
    zip.start_file(DB_NAME_IN_ZIP, options)
        .map_err(|e| format!("Failed to start zip entry: {}", e))?;
    zip.write_all(&db_data)
        .map_err(|e| format!("Failed to write zip data: {}", e))?;
    zip.finish()
        .map_err(|e| format!("Failed to finalize zip: {}", e))?;
    Ok(())
}

fn extract_db_from_zip(zip_path: &PathBuf, db_dest: &PathBuf) -> Result<(), String> {
    let zip_file =
        File::open(zip_path).map_err(|e| format!("Failed to open zip file: {}", e))?;
    let mut archive =
        ZipArchive::new(zip_file).map_err(|e| format!("Not a valid zip file: {}", e))?;
    let mut entry = archive
        .by_name(DB_NAME_IN_ZIP)
        .map_err(|_| format!("Zip does not contain {}", DB_NAME_IN_ZIP))?;
    let mut data = Vec::new();
    entry
        .read_to_end(&mut data)
        .map_err(|e| format!("Failed to read from zip: {}", e))?;
    fs::write(db_dest, &data).map_err(|e| format!("Failed to write database: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn create_snapshot(app: AppHandle) -> Result<(), String> {
    let source = db_path(&app)?;
    if !source.exists() {
        return Err("Database file not found.".to_string());
    }
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let snapshot_name = format!("snapshot-{}.mnemo.zip", epoch_secs());
    let zip_path = data_dir.join(&snapshot_name);
    compress_db_to_zip(&source, &zip_path)?;
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
        if filename.starts_with("snapshot-") && filename.ends_with(".mnemo.zip") {
            let meta = entry.metadata().map_err(|e| e.to_string())?;
            let created_secs = filename
                .trim_start_matches("snapshot-")
                .trim_end_matches(".mnemo.zip")
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
pub async fn export_snapshot(
    app: AppHandle,
    filename: String,
    dest_path: String,
) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = data_dir.join(&filename);
    if !path.exists() {
        return Err("Snapshot not found.".to_string());
    }
    let fname = path.file_name().unwrap_or_default().to_string_lossy();
    if !fname.starts_with("snapshot-") || !fname.ends_with(".mnemo.zip") {
        return Err("Invalid snapshot filename.".to_string());
    }
    fs::copy(&path, &dest_path).map_err(|e| format!("Failed to export: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn restore_snapshot(app: AppHandle, source_path: String) -> Result<(), String> {
    let source = PathBuf::from(&source_path);
    if !source.exists() {
        return Err("File not found.".to_string());
    }

    let db_file = db_path(&app)?;

    // Safety: save current DB as snapshot before restoring
    if db_file.exists() {
        let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let safety_name = format!("snapshot-{}.mnemo.zip", epoch_secs());
        compress_db_to_zip(&db_file, &data_dir.join(&safety_name))?;
    }

    // Extract DB from zip
    extract_db_from_zip(&source, &db_file)?;

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
    if !fname.starts_with("snapshot-") || !fname.ends_with(".mnemo.zip") {
        return Err("Invalid snapshot filename.".to_string());
    }
    fs::remove_file(&path).map_err(|e| format!("Failed to delete: {}", e))?;
    Ok(())
}
