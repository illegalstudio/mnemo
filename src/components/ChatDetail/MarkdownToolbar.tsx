export type ToolMode = "none" | "highlight" | "cut";

interface MarkdownToolbarProps {
  tool: ToolMode;
  notice: string | null;
  onToggleHighlight: () => void;
  onToggleCut: () => void;
}

export default function MarkdownToolbar({ tool, notice, onToggleHighlight, onToggleCut }: MarkdownToolbarProps) {
  return (
    <div className="md-toolbar">
      <button
        type="button"
        className={`md-toolbar-btn${tool === "highlight" ? " armed" : ""}`}
        title={tool === "highlight" ? "Highlighter on — drag over text to highlight (Esc to stop)" : "Highlighter — click, then drag over the text"}
        aria-pressed={tool === "highlight"}
        onClick={onToggleHighlight}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 11-6 6v3h9l3-3" />
          <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
        </svg>
      </button>
      <button
        type="button"
        className={`md-toolbar-btn${tool === "cut" ? " armed" : ""}`}
        title={tool === "cut" ? "Cut on — click between blocks to delete or split (Esc to stop)" : "Cut — click, then pick a spot between blocks"}
        aria-pressed={tool === "cut"}
        onClick={onToggleCut}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="6" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <line x1="20" y1="4" x2="8.12" y2="15.88" />
          <line x1="14.47" y1="14.48" x2="20" y2="20" />
          <line x1="8.12" y1="8.12" x2="12" y2="12" />
        </svg>
      </button>
      {tool === "highlight" && <span className="md-toolbar-status">Drag to highlight · Esc to stop</span>}
      {tool === "cut" && <span className="md-toolbar-status">Click between blocks · Esc to stop</span>}
      {notice && <span className="md-toolbar-notice">{notice}</span>}
    </div>
  );
}
