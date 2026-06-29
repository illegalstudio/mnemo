import { HIGHLIGHT_COLORS, type HighlightColor } from "../../lib/highlight";

interface MarkdownToolbarProps {
  activeHighlightId: string | null;
  notice: string | null;
  onColor: (color: HighlightColor) => void;
  onRemove: () => void;
}

const COLOR_SWATCH: Record<HighlightColor, string> = {
  yellow: "#fde68a",
  green: "#bbf7d0",
  pink: "#fbcfe8",
  blue: "#bfdbfe",
};

export default function MarkdownToolbar({ activeHighlightId, notice, onColor, onRemove }: MarkdownToolbarProps) {
  return (
    <div className="md-toolbar" onMouseDown={(e) => e.preventDefault()}>
      <span className="md-toolbar-label" title={activeHighlightId ? "Change highlight color" : "Select text, then pick a color to highlight"}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
        </svg>
      </span>
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c}
          className="md-toolbar-swatch"
          style={{ background: COLOR_SWATCH[c] }}
          title={activeHighlightId ? `Recolor: ${c}` : `Highlight: ${c}`}
          onClick={() => onColor(c)}
        />
      ))}
      {activeHighlightId && (
        <button className="md-toolbar-remove" title="Remove highlight" onClick={onRemove}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
        </button>
      )}
      {notice && <span className="md-toolbar-notice">{notice}</span>}
    </div>
  );
}
