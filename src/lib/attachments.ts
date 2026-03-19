import { appDataDir, join } from "@tauri-apps/api/path";
import { mkdir, copyFile, exists, remove } from "@tauri-apps/plugin-fs";
import { v4 as uuidv4 } from "uuid";

const ATTACHMENTS_DIR = "attachments";

let cachedDataDir: string | null = null;

async function getDataDir(): Promise<string> {
  if (!cachedDataDir) {
    cachedDataDir = await appDataDir();
  }
  return cachedDataDir;
}

/**
 * Resolve a (possibly relative) attachment path to an absolute filesystem path.
 * - data: URIs pass through unchanged
 * - Absolute paths (starting with /) pass through unchanged
 * - Relative paths are resolved against the app data directory
 */
export async function resolveAttachmentPath(filePath: string): Promise<string> {
  if (filePath.startsWith("data:") || filePath.startsWith("/")) {
    return filePath;
  }
  const base = await getDataDir();
  return await join(base, filePath);
}

/**
 * Ensure the attachments/ directory exists inside app data.
 */
export async function ensureAttachmentsDir(): Promise<void> {
  const base = await getDataDir();
  const dirPath = await join(base, ATTACHMENTS_DIR);
  const dirExists = await exists(dirPath);
  if (!dirExists) {
    await mkdir(dirPath);
  }
}

/**
 * Copy a file into the app data attachments directory.
 * Returns the relative path (e.g. "attachments/uuid.ext") to store in the DB.
 */
export async function copyAttachmentToAppData(
  sourceAbsolutePath: string,
  originalFilename: string
): Promise<string> {
  await ensureAttachmentsDir();
  const ext = originalFilename.split(".").pop() || "bin";
  const storedName = `${uuidv4()}.${ext}`;
  const relativePath = `${ATTACHMENTS_DIR}/${storedName}`;
  const destAbsolute = await resolveAttachmentPath(relativePath);
  await copyFile(sourceAbsolutePath, destAbsolute);
  return relativePath;
}

/**
 * Delete an attachment file from the app data directory.
 * Only deletes managed (relative) paths; skips data: URIs and absolute paths.
 */
export async function deleteAttachmentFile(filePath: string): Promise<void> {
  if (filePath.startsWith("data:") || filePath.startsWith("/")) return;
  try {
    const absPath = await resolveAttachmentPath(filePath);
    await remove(absPath);
  } catch {
    // File may already be gone
  }
}
