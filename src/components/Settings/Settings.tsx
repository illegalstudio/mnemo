import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save, open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { closeDb } from "../../lib/db";
import type { ThemeMode } from "../../hooks/useTheme";
import type { AnalysisSettings, LangCode } from "../../hooks/useAnalysisSettings";
import { LANGUAGES } from "../../hooks/useAnalysisSettings";
import { bookmarklets } from "../../lib/bookmarklets";

interface Snapshot {
  filename: string;
  path: string;
  size_bytes: number;
  created_at: number;
}

interface SettingsProps {
  themeMode: ThemeMode;
  onSetTheme: (mode: ThemeMode) => void;
  analysisSettings: AnalysisSettings;
  onUpdateAnalysis: (updates: Partial<AnalysisSettings>) => void;
  onUpdateAnalysisFields: (fields: Partial<AnalysisSettings["fields"]>) => void;
  onUpdateAnalysisLanguages: (languages: Partial<AnalysisSettings["languages"]>) => void;
  onClose: () => void;
}

const themes: { value: ThemeMode; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "\u2600" },
  { value: "dark", label: "Dark", icon: "\u263E" },
  { value: "system", label: "System", icon: "\u2699" },
];

function LangSelect({ value, onChange }: { value: LangCode; onChange: (v: LangCode) => void }) {
  return (
    <select
      className="settings-lang-select"
      value={value}
      onChange={(e) => onChange(e.target.value as LangCode)}
    >
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>{l.label}</option>
      ))}
    </select>
  );
}

export default function Settings({
  themeMode, onSetTheme,
  analysisSettings, onUpdateAnalysis, onUpdateAnalysisFields, onUpdateAnalysisLanguages,
  onClose,
}: SettingsProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapshotStatus, setSnapshotStatus] = useState<string | null>(null);

  const loadSnapshots = useCallback(async () => {
    try {
      const list = await invoke<Snapshot[]>("list_snapshots");
      setSnapshots(list);
    } catch (e) {
      console.error("Failed to load snapshots:", e);
    }
  }, []);

  useEffect(() => { loadSnapshots(); }, [loadSnapshots]);

  const handleCreateSnapshot = async () => {
    try {
      await closeDb();
      await invoke("create_snapshot");
      setSnapshotStatus("Snapshot created");
      await loadSnapshots();
      setTimeout(() => setSnapshotStatus(null), 3000);
    } catch (e) {
      setSnapshotStatus("Error: " + e);
    }
  };

  const handleExportSnapshot = async (snap: Snapshot) => {
    const date = new Date(snap.created_at * 1000);
    const defaultName = `mnemo_${date.getFullYear()}${String(date.getMonth()+1).padStart(2,"0")}${String(date.getDate()).padStart(2,"0")}_${String(date.getHours()).padStart(2,"0")}${String(date.getMinutes()).padStart(2,"0")}.mnemo.zip`;
    const dest = await save({ defaultPath: defaultName, filters: [{ name: "Mnemo Backup", extensions: ["mnemo.zip"] }] });
    if (dest) {
      try {
        await invoke("export_snapshot", { filename: snap.filename, destPath: dest });
        setSnapshotStatus("Snapshot exported");
        setTimeout(() => setSnapshotStatus(null), 3000);
      } catch (e) {
        setSnapshotStatus("Export error: " + e);
      }
    }
  };

  const handleRestoreSnapshot = async (snap: Snapshot) => {
    if (!window.confirm("Restore this snapshot? A safety snapshot of the current state will be created first.")) return;
    try {
      await closeDb();
      await invoke("restore_snapshot", { sourcePath: snap.path });
      setSnapshotStatus("Restored. Reloading...");
      setTimeout(() => window.location.reload(), 500);
    } catch (e) {
      setSnapshotStatus("Restore error: " + e);
    }
  };

  const handleDeleteSnapshot = async (snap: Snapshot) => {
    if (!window.confirm("Delete this snapshot?")) return;
    try {
      await invoke("delete_snapshot", { filename: snap.filename });
      await loadSnapshots();
    } catch (e) {
      setSnapshotStatus("Delete error: " + e);
    }
  };

  const handleRestoreFromFile = async () => {
    try {
      const selected = await dialogOpen({
        multiple: false,
        directory: false,
        filters: [{ name: "Mnemo Backup", extensions: ["mnemo.zip"] }],
      });
      console.log("[restore] selected:", selected);
      if (!selected) return;
      const filePath = typeof selected === "string" ? selected : String(selected);
      await closeDb();
      await invoke("restore_snapshot", { sourcePath: filePath });
      setSnapshotStatus("Restored. Reloading...");
      setTimeout(() => window.location.reload(), 1000);
    } catch (e) {
      console.error("[restore] error:", e);
      setSnapshotStatus("Restore error: " + e);
    }
  };

  const handleCopy = (name: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopied(name);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <h2>Settings</h2>
        <button className="close-btn" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="settings-scroll">
        {/* Appearance */}
        <div className="settings-section">
          <h3>Appearance</h3>
          <div className="theme-options">
            {themes.map((t) => (
              <button
                key={t.value}
                className={`theme-option ${themeMode === t.value ? "active" : ""}`}
                onClick={() => onSetTheme(t.value)}
              >
                <span className="theme-option-icon">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Analysis */}
        <div className="settings-section">
          <h3>AI Analysis</h3>

          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={analysisSettings.enabled}
              onChange={(e) => onUpdateAnalysis({ enabled: e.target.checked })}
            />
            <span>Auto-analyze imported chats</span>
          </label>

          {analysisSettings.enabled && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>
              {/* Tool */}
              <div>
                <label className="settings-label">Tool</label>
                <select
                  className="settings-select"
                  value={analysisSettings.tool}
                  onChange={(e) => onUpdateAnalysis({ tool: e.target.value as AnalysisSettings["tool"] })}
                >
                  <option value="claude-code">Claude Code (CLI)</option>
                </select>
              </div>

              {/* Fields + language per field */}
              <div>
                <label className="settings-label">Fields to generate</label>
                <div className="settings-field-rows">
                  <div className="settings-field-row">
                    <label className="settings-toggle">
                      <input type="checkbox" checked={analysisSettings.fields.title} onChange={(e) => onUpdateAnalysisFields({ title: e.target.checked })} />
                      <span>Title</span>
                    </label>
                    {analysisSettings.fields.title && (
                      <LangSelect value={analysisSettings.languages.title} onChange={(v) => onUpdateAnalysisLanguages({ title: v })} />
                    )}
                  </div>
                  <div className="settings-field-row">
                    <label className="settings-toggle">
                      <input type="checkbox" checked={analysisSettings.fields.summary} onChange={(e) => onUpdateAnalysisFields({ summary: e.target.checked })} />
                      <span>Summary</span>
                    </label>
                    {analysisSettings.fields.summary && (
                      <LangSelect value={analysisSettings.languages.summary} onChange={(v) => onUpdateAnalysisLanguages({ summary: v })} />
                    )}
                  </div>
                  <div className="settings-field-row">
                    <label className="settings-toggle">
                      <input type="checkbox" checked={analysisSettings.fields.tags} onChange={(e) => onUpdateAnalysisFields({ tags: e.target.checked })} />
                      <span>Tags</span>
                    </label>
                    {analysisSettings.fields.tags && (
                      <LangSelect value={analysisSettings.languages.tags} onChange={(v) => onUpdateAnalysisLanguages({ tags: v })} />
                    )}
                  </div>
                </div>
              </div>

              {/* Tag count */}
              {analysisSettings.fields.tags && (
                <div>
                  <label className="settings-label">Number of tags</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="number"
                      className="settings-number"
                      value={analysisSettings.tagCount.min}
                      min={1} max={10}
                      onChange={(e) => onUpdateAnalysis({ tagCount: { ...analysisSettings.tagCount, min: parseInt(e.target.value) || 1 } })}
                    />
                    <span style={{ color: "var(--text-faint)", fontSize: 12 }}>to</span>
                    <input
                      type="number"
                      className="settings-number"
                      value={analysisSettings.tagCount.max}
                      min={1} max={20}
                      onChange={(e) => onUpdateAnalysis({ tagCount: { ...analysisSettings.tagCount, max: parseInt(e.target.value) || 6 } })}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Snapshots */}
        <div className="settings-section">
          <h3>Database Snapshots</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <button className="import-btn" onClick={handleCreateSnapshot} style={{ flex: "none" }}>
              Create Snapshot
            </button>
            <button className="snapshot-restore-btn" onClick={handleRestoreFromFile}>
              Restore from File
            </button>
            {snapshotStatus && (
              <span style={{ fontSize: 12, color: snapshotStatus.startsWith("Error") ? "var(--red)" : "var(--green)" }}>
                {snapshotStatus}
              </span>
            )}
          </div>
          {snapshots.length > 0 ? (
            <div className="snapshot-list">
              {snapshots.map((snap) => {
                const date = new Date(snap.created_at * 1000);
                const dateStr = date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
                const timeStr = date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
                const sizeKb = (snap.size_bytes / 1024).toFixed(0);
                const sizeMb = (snap.size_bytes / (1024 * 1024)).toFixed(1);
                const sizeStr = snap.size_bytes > 1024 * 1024 ? `${sizeMb} MB` : `${sizeKb} KB`;

                return (
                  <div key={snap.filename} className="snapshot-row">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: "var(--text-primary)" }}>{dateStr} {timeStr}</div>
                      <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{sizeStr}</div>
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="snapshot-action" onClick={() => handleExportSnapshot(snap)} title="Download">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 3v12m0 0l-4-4m4 4l4-4" /></svg>
                      </button>
                      <button className="snapshot-action" onClick={() => handleRestoreSnapshot(snap)} title="Restore">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 019-9 9.75 9.75 0 016.74 2.74L21 8M3 3v5h5M21 12a9 9 0 01-9 9 9.75 9.75 0 01-6.74-2.74L3 16m18 5v-5h-5" /></svg>
                      </button>
                      <button className="snapshot-action danger" onClick={() => handleDeleteSnapshot(snap)} title="Delete">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p style={{ fontSize: 12, color: "var(--text-faint)", fontStyle: "italic" }}>No snapshots yet</p>
          )}
        </div>

        {/* Bookmarklets */}
        <div className="settings-section">
          <h3>Bookmarklets</h3>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
            Copy a bookmarklet link and create a new bookmark in your browser with the copied text as the URL.
            Click it while viewing a conversation to send it to Mnemo.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {bookmarklets.map((b) => (
              <div key={b.name} className="bookmarklet-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", marginBottom: 2 }}>
                    {b.name}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
                    {b.instructions}
                  </div>
                </div>
                <button
                  className="bookmarklet-copy-btn"
                  onClick={() => handleCopy(b.name, b.url)}
                >
                  {copied === b.name ? "Copied!" : "Copy"}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
