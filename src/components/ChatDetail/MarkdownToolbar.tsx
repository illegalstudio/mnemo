interface MarkdownToolbarProps {
  armed: boolean;
  notice: string | null;
  onToggle: () => void;
}

export default function MarkdownToolbar({ armed, notice, onToggle }: MarkdownToolbarProps) {
  return (
    <div className="md-toolbar">
      <button
        type="button"
        className={`md-toolbar-btn${armed ? " armed" : ""}`}
        title={armed ? "Highlighter on — drag over text to highlight (Esc to stop)" : "Highlighter — click, then drag over the text"}
        aria-pressed={armed}
        onClick={onToggle}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 11-6 6v3h9l3-3" />
          <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
        </svg>
      </button>
      {armed && <span className="md-toolbar-status">Drag to highlight · Esc to stop</span>}
      {notice && <span className="md-toolbar-notice">{notice}</span>}
    </div>
  );
}
