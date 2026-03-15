import type { ThemeMode } from "../../hooks/useTheme";

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
      </div>
    </div>
  );
}
