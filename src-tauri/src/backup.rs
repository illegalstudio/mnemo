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
const ATTACHMENTS_PREFIX: &str = "attachments/";

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

fn attachments_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(data_dir.join("attachments"))
}

fn epoch_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn flush_wal(db_file: &PathBuf) -> Result<(), String> {
    // Force SQLite to flush WAL to main database file for a consistent snapshot
    let conn = rusqlite::Connection::open(db_file)
        .map_err(|e| format!("Failed to open DB for WAL checkpoint: {}", e))?;
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| format!("Failed to flush WAL: {}", e))?;
    drop(conn);
    Ok(())
}

fn create_snapshot_zip(db_file: &PathBuf, att_dir: &PathBuf, zip_path: &PathBuf) -> Result<(), String> {
    flush_wal(db_file)?;
    let db_data = fs::read(db_file).map_err(|e| format!("Failed to read database: {}", e))?;
    let zip_file =
        File::create(zip_path).map_err(|e| format!("Failed to create zip file: {}", e))?;
    let mut zip = ZipWriter::new(zip_file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .compression_level(Some(6));

    // Write database
    zip.start_file(DB_NAME_IN_ZIP, options)
        .map_err(|e| format!("Failed to start zip entry: {}", e))?;
    zip.write_all(&db_data)
        .map_err(|e| format!("Failed to write zip data: {}", e))?;

    // Write attachments
    if att_dir.exists() && att_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(att_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let filename = entry.file_name().to_string_lossy().to_string();
                    let zip_entry_name = format!("{}{}", ATTACHMENTS_PREFIX, filename);
                    if let Ok(data) = fs::read(&path) {
                        zip.start_file(&zip_entry_name, options)
                            .map_err(|e| format!("Failed to add attachment {}: {}", filename, e))?;
                        zip.write_all(&data)
                            .map_err(|e| format!("Failed to write attachment {}: {}", filename, e))?;
                    }
                }
            }
        }
    }

    zip.finish()
        .map_err(|e| format!("Failed to finalize zip: {}", e))?;
    Ok(())
}

fn restore_snapshot_zip(zip_path: &PathBuf, db_dest: &PathBuf, att_dir: &PathBuf) -> Result<(), String> {
    let zip_file =
        File::open(zip_path).map_err(|e| format!("Failed to open zip file: {}", e))?;
    let mut archive =
        ZipArchive::new(zip_file).map_err(|e| format!("Not a valid zip file: {}", e))?;

    // Extract database
    {
        let mut entry = archive
            .by_name(DB_NAME_IN_ZIP)
            .map_err(|_| format!("Zip does not contain {}", DB_NAME_IN_ZIP))?;
        let mut data = Vec::new();
        entry
            .read_to_end(&mut data)
            .map_err(|e| format!("Failed to read from zip: {}", e))?;
        fs::write(db_dest, &data).map_err(|e| format!("Failed to write database: {}", e))?;
    }

    // Remove existing attachments directory and recreate
    if att_dir.exists() {
        let _ = fs::remove_dir_all(att_dir);
    }

    // Extract attachments (if any in the zip)
    let has_attachments = (0..archive.len()).any(|i| {
        archive
            .by_index(i)
            .map(|e| e.name().starts_with(ATTACHMENTS_PREFIX) && e.name().len() > ATTACHMENTS_PREFIX.len())
            .unwrap_or(false)
    });

    if has_attachments {
        fs::create_dir_all(att_dir)
            .map_err(|e| format!("Failed to create attachments dir: {}", e))?;

        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
            let name = entry.name().to_string();
            if name.starts_with(ATTACHMENTS_PREFIX) && name.len() > ATTACHMENTS_PREFIX.len() {
                let filename = &name[ATTACHMENTS_PREFIX.len()..];
                let dest_path = att_dir.join(filename);
                let mut data = Vec::new();
                entry
                    .read_to_end(&mut data)
                    .map_err(|e| format!("Failed to read attachment {}: {}", filename, e))?;
                fs::write(&dest_path, &data)
                    .map_err(|e| format!("Failed to write attachment {}: {}", filename, e))?;
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn create_snapshot(app: AppHandle) -> Result<(), String> {
    let source = db_path(&app)?;
    if !source.exists() {
        return Err("Database file not found.".to_string());
    }
    let att_dir = attachments_dir(&app)?;
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let snapshot_name = format!("snapshot-{}.mnemo.zip", epoch_secs());
    let zip_path = data_dir.join(&snapshot_name);
    create_snapshot_zip(&source, &att_dir, &zip_path)?;
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
    let att_dir = attachments_dir(&app)?;
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    // Safety: save current DB + attachments as snapshot before restoring
    if db_file.exists() {
        let safety_name = format!("snapshot-{}.mnemo.zip", epoch_secs());
        create_snapshot_zip(&db_file, &att_dir, &data_dir.join(&safety_name))?;
    }

    // Extract DB + attachments from zip
    restore_snapshot_zip(&source, &db_file, &att_dir)?;

    // Clear Tantivy search index so it gets rebuilt on next launch
    let tantivy_dir = data_dir.join("tantivy_index");
    if tantivy_dir.exists() {
        let _ = fs::remove_dir_all(&tantivy_dir);
    }

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
