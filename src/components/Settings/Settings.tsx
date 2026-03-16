import { useState } from "react";
import type { ThemeMode } from "../../hooks/useTheme";
import type { AnalysisSettings } from "../../hooks/useAnalysisSettings";
import { bookmarklets } from "../../lib/bookmarklets";

interface SettingsProps {
  themeMode: ThemeMode;
  onSetTheme: (mode: ThemeMode) => void;
  analysisSettings: AnalysisSettings;
  onUpdateAnalysis: (updates: Partial<AnalysisSettings>) => void;
  onUpdateAnalysisFields: (fields: Partial<AnalysisSettings["fields"]>) => void;
  onResetPrompt: () => void;
  onClose: () => void;
}

const themes: { value: ThemeMode; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "\u2600" },
  { value: "dark", label: "Dark", icon: "\u263E" },
  { value: "system", label: "System", icon: "\u2699" },
];

export default function Settings({
  themeMode, onSetTheme,
  analysisSettings, onUpdateAnalysis, onUpdateAnalysisFields, onResetPrompt,
  onClose,
}: SettingsProps) {
  const [copied, setCopied] = useState<string | null>(null);

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

          {/* Enable/disable */}
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={analysisSettings.enabled}
              onChange={(e) => onUpdateAnalysis({ enabled: e.target.checked })}
            />
            <span>Auto-analyze imported chats</span>
          </label>

          {analysisSettings.enabled && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
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

              {/* Fields */}
              <div>
                <label className="settings-label">Fields to generate</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label className="settings-toggle">
                    <input type="checkbox" checked={analysisSettings.fields.title} onChange={(e) => onUpdateAnalysisFields({ title: e.target.checked })} />
                    <span>Title</span>
                  </label>
                  <label className="settings-toggle">
                    <input type="checkbox" checked={analysisSettings.fields.summary} onChange={(e) => onUpdateAnalysisFields({ summary: e.target.checked })} />
                    <span>Summary</span>
                  </label>
                  <label className="settings-toggle">
                    <input type="checkbox" checked={analysisSettings.fields.tags} onChange={(e) => onUpdateAnalysisFields({ tags: e.target.checked })} />
                    <span>Tags</span>
                  </label>
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

              {/* Prompt */}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <label className="settings-label" style={{ marginBottom: 0 }}>Prompt</label>
                  <button
                    onClick={onResetPrompt}
                    style={{ border: "none", background: "none", color: "var(--text-faint)", cursor: "pointer", fontSize: 11 }}
                  >
                    Reset to default
                  </button>
                </div>
                <textarea
                  className="settings-textarea"
                  value={analysisSettings.prompt}
                  onChange={(e) => onUpdateAnalysis({ prompt: e.target.value })}
                  rows={6}
                />
              </div>
            </div>
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
