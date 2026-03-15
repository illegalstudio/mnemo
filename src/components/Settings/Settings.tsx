import { useState } from "react";
import type { ThemeMode } from "../../hooks/useTheme";
import { bookmarklets } from "../../lib/bookmarklets";

interface SettingsProps {
  themeMode: ThemeMode;
  onSetTheme: (mode: ThemeMode) => void;
  onClose: () => void;
}

const themes: { value: ThemeMode; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "\u2600" },
  { value: "dark", label: "Dark", icon: "\u263E" },
  { value: "system", label: "System", icon: "\u2699" },
];

export default function Settings({ themeMode, onSetTheme, onClose }: SettingsProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = (name: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopied(name);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <h2>Settings</h2>
          <button className="close-btn" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

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
