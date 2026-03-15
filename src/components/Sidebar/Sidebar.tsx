import { useState, useEffect } from "react";
import type { Chat, Source, Tag, TagWithCount } from "../../types";
import { TagTree } from "../TagTree/TagTree";
import { useDebounce } from "../../hooks/useDebounce";

interface SidebarProps {
  tags: TagWithCount[];
  selectedTagId: string | null;
  selectedSource: Source | null;
  searchQuery: string;
  recentChats: Chat[];
  onSearch: (query: string) => void;
  onSelectTag: (tagId: string | null) => void;
  onSelectSource: (source: Source | null) => void;
  onSelectChat: (chat: Chat) => void;
  onCreateTag: (name: string, parentId?: string, color?: string) => void;
  onUpdateTag: (id: string, updates: Partial<Tag>) => void;
  onDeleteTag: (id: string) => void;
}

const sources: { value: Source | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "claude", label: "Claude" },
  { value: "perplexity", label: "Perplexity" },
  { value: "chatgpt", label: "ChatGPT" },
  { value: "other", label: "Other" },
];

const sourceColors: Record<string, string> = {
  claude: "#D08770",
  perplexity: "#81A1C1",
  chatgpt: "#A3BE8C",
  other: "#4C566A",
};

const tagColors = ["#88C0D0", "#81A1C1", "#5E81AC", "#BF616A", "#D08770", "#EBCB8B", "#A3BE8C", "#B48EAD"];

export function Sidebar({
  tags, selectedTagId, selectedSource, searchQuery, recentChats,
  onSearch, onSelectTag, onSelectSource, onSelectChat,
  onCreateTag, onUpdateTag, onDeleteTag,
}: SidebarProps) {
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const debouncedSearch = useDebounce(localSearch, 300);

  useEffect(() => { onSearch(debouncedSearch); }, [debouncedSearch, onSearch]);

  function handleCreateTag() {
    const name = window.prompt("Tag name:");
    if (name?.trim()) {
      const color = tagColors[Math.floor(Math.random() * tagColors.length)];
      onCreateTag(name.trim(), undefined, color);
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
          </svg>
        </div>
        <span className="sidebar-title">Mnemo</span>
      </div>

      <div className="sidebar-search" style={{ position: "relative" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ position: "absolute", left: 22, top: 9, color: "var(--text-faint)" }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          type="text"
          placeholder="Search..."
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
        />
      </div>

      <div className="sidebar-scroll">
        {/* Tags */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">
            Tags
            <button onClick={handleCreateTag} style={{ border: "none", background: "none", color: "var(--text-faint)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }} title="New tag">+</button>
          </div>
          {tags.length > 0 ? (
            <TagTree tags={tags} selectedTagId={selectedTagId} onSelect={onSelectTag} onCreateTag={onCreateTag} onUpdateTag={onUpdateTag} onDeleteTag={onDeleteTag} />
          ) : (
            <div style={{ fontSize: 11, color: "var(--text-faint)", padding: "0 8px", fontStyle: "italic" }}>No tags yet</div>
          )}
        </div>

        {/* Sources */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">Sources</div>
          {sources.map((s) => (
            <button
              key={String(s.value)}
              className={`sidebar-btn ${selectedSource === s.value ? "active" : ""}`}
              onClick={() => onSelectSource(s.value)}
            >
              <span className="dot" style={{ backgroundColor: s.value ? sourceColors[s.value] : "transparent", border: s.value ? "none" : "1px solid var(--text-faint)" }} />
              {s.label}
            </button>
          ))}
        </div>

        {/* Recent */}
        {recentChats.length > 0 && (
          <div className="sidebar-section">
            <div className="sidebar-section-title">Recent</div>
            {recentChats.map((chat) => (
              <button key={chat.id} className="sidebar-btn-small" onClick={() => onSelectChat(chat)}>
                {chat.title}
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
