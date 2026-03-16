import { useState, useEffect, useRef } from "react";
import type { Chat, Source, Tag, TagWithCount, FolderWithCount } from "../../types";
import { TagTree } from "../TagTree/TagTree";
import { FolderTree } from "../FolderTree/FolderTree";
import { useDebounce } from "../../hooks/useDebounce";

interface SidebarProps {
  tags: TagWithCount[];
  folders: FolderWithCount[];
  unfiledCount: number;
  selectedTagIds: Set<string>;
  selectedSource: Source | null;
  selectedFolderId: string | null;
  searchQuery: string;
  recentChats: Chat[];
  onSearch: (query: string) => void;
  onToggleTag: (tagId: string) => void;
  onSelectTag: (tagId: string) => void;
  onClearTags: () => void;
  onSelectSource: (source: Source | null) => void;
  onSelectChat: (chat: Chat) => void;
  onCreateTag: (name: string, parentId?: string, color?: string) => void;
  onUpdateTag: (id: string, updates: Partial<Tag>) => void;
  onDeleteTag: (id: string) => void;
  onSelectFolder: (folderId: string | null) => void;
  onCreateFolder: (name: string, parentId?: string, color?: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onMoveChatToFolder: (chatId: string, folderId: string | null) => void;
  onMoveFolderToParent: (folderId: string, newParentId: string | null) => Promise<boolean>;
  onOpenSettings: () => void;
  onImportClick: () => void;
}

const sources: { value: Source | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "claude", label: "Claude" },
  { value: "perplexity", label: "Perplexity" },
  { value: "chatgpt", label: "ChatGPT" },
  { value: "other", label: "Other" },
];

const sourceColors: Record<string, string> = {
  claude: "var(--source-claude)",
  perplexity: "var(--source-perplexity)",
  chatgpt: "var(--source-chatgpt)",
  other: "var(--source-other)",
};

const tagColors = ["#88C0D0", "#81A1C1", "#5E81AC", "#BF616A", "#D08770", "#EBCB8B", "#A3BE8C", "#B48EAD"];

const COLLAPSED_KEY = "mnemo-sidebar-collapsed";

function loadCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSED_KEY) || "{}");
  } catch {
    return {};
  }
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg className={`section-chevron ${expanded ? "expanded" : ""}`} width="10" height="10" viewBox="0 0 20 20" fill="currentColor">
      <path d="M6 4l8 6-8 6V4z" />
    </svg>
  );
}

function InlineInput({ onSubmit, onCancel, placeholder }: { onSubmit: (value: string) => void; onCancel: () => void; placeholder: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <input
      ref={ref}
      className="inline-create-input"
      placeholder={placeholder}
      autoComplete="off" autoCorrect="off" spellCheck={false}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const val = (e.target as HTMLInputElement).value.trim();
          if (val) onSubmit(val);
          onCancel();
        } else if (e.key === "Escape") {
          onCancel();
        }
      }}
      onBlur={(e) => {
        const val = e.target.value.trim();
        if (val) onSubmit(val);
        onCancel();
      }}
    />
  );
}

export function Sidebar({
  tags, folders, unfiledCount, selectedTagIds, selectedSource, selectedFolderId, searchQuery, recentChats,
  onSearch, onToggleTag, onSelectTag, onClearTags, onSelectSource, onSelectChat,
  onCreateTag, onUpdateTag, onDeleteTag,
  onSelectFolder, onCreateFolder, onRenameFolder, onDeleteFolder, onMoveChatToFolder, onMoveFolderToParent,
  onOpenSettings, onImportClick,
}: SidebarProps) {
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const debouncedSearch = useDebounce(localSearch, 300);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);
  const [creatingTag, setCreatingTag] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);

  useEffect(() => { onSearch(debouncedSearch); }, [debouncedSearch, onSearch]);

  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
  }, [collapsed]);

  function toggleSection(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <aside className="sidebar-inner">
      <div className="sidebar-header">
        <div className="sidebar-header-left">
          <div className="sidebar-logo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          </div>
          <span className="sidebar-title">Mnemo</span>
        </div>
        <button className="settings-btn" onClick={onOpenSettings} title="Settings">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>

      <div style={{ padding: "0 12px 8px" }}>
        <button className="import-btn" onClick={onImportClick} style={{ width: "100%" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Import
        </button>
      </div>

      <div className="sidebar-search">
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ position: "absolute", left: 10, color: "var(--text-faint)", pointerEvents: "none" }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            placeholder="Search..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
          />
          {localSearch && (
            <button onClick={() => setLocalSearch("")} style={{ position: "absolute", right: 8, border: "none", background: "none", color: "var(--text-faint)", cursor: "pointer", padding: 2, display: "flex", alignItems: "center" }} title="Clear search">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="sidebar-scroll">
        {/* Folders */}
        <div className="sidebar-section">
          <div className="sidebar-section-title" onClick={() => toggleSection("folders")} style={{ cursor: "pointer" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <ChevronIcon expanded={!collapsed.folders} />
              Folders
            </span>
            <button onClick={(e) => { e.stopPropagation(); setCreatingFolder(true); }} style={{ border: "none", background: "none", color: "var(--text-faint)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }} title="New folder">+</button>
          </div>
          {!collapsed.folders && (
            <>
              {creatingFolder && (
                <div style={{ padding: "2px 8px" }}>
                  <InlineInput
                    placeholder="Folder name..."
                    onSubmit={(name) => onCreateFolder(name)}
                    onCancel={() => setCreatingFolder(false)}
                  />
                </div>
              )}
              <FolderTree
                folders={folders ?? []}
                unfiledCount={unfiledCount}
                selectedFolderId={selectedFolderId}
                onSelect={onSelectFolder}
                onCreateFolder={onCreateFolder}
                onRenameFolder={onRenameFolder}
                onDeleteFolder={onDeleteFolder}
                onMoveChatToFolder={onMoveChatToFolder}
                onMoveFolderToParent={onMoveFolderToParent}
              />
              {selectedFolderId && (
                <button onClick={() => onSelectFolder(null)} style={{ border: "none", background: "none", color: "var(--text-faint)", cursor: "pointer", fontSize: 11, padding: "4px 8px", marginTop: 4 }}>Clear selection</button>
              )}
            </>
          )}
        </div>

        {/* Tags */}
        <div className="sidebar-section">
          <div className="sidebar-section-title" onClick={() => toggleSection("tags")} style={{ cursor: "pointer" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <ChevronIcon expanded={!collapsed.tags} />
              Tags
            </span>
            <button onClick={(e) => { e.stopPropagation(); setCreatingTag(true); }} style={{ border: "none", background: "none", color: "var(--text-faint)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }} title="New tag">+</button>
          </div>
          {!collapsed.tags && (
            <>
              {creatingTag && (
                <div style={{ padding: "2px 8px" }}>
                  <InlineInput
                    placeholder="Tag name..."
                    onSubmit={(name) => {
                      const color = tagColors[Math.floor(Math.random() * tagColors.length)];
                      onCreateTag(name, undefined, color);
                    }}
                    onCancel={() => setCreatingTag(false)}
                  />
                </div>
              )}
              {tags.length > 0 ? (
                <TagTree tags={tags} selectedTagIds={selectedTagIds} onToggle={onToggleTag} onSelect={onSelectTag} onCreateTag={onCreateTag} onUpdateTag={onUpdateTag} onDeleteTag={onDeleteTag} />
              ) : !creatingTag ? (
                <div style={{ fontSize: 11, color: "var(--text-faint)", padding: "0 8px", fontStyle: "italic" }}>No tags yet</div>
              ) : null}
              {selectedTagIds.size > 0 && (
                <button onClick={onClearTags} style={{ border: "none", background: "none", color: "var(--text-faint)", cursor: "pointer", fontSize: 11, padding: "4px 8px", marginTop: 4 }}>Clear selection</button>
              )}
            </>
          )}
        </div>

        {/* Sources */}
        <div className="sidebar-section">
          <div className="sidebar-section-title" onClick={() => toggleSection("sources")} style={{ cursor: "pointer" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <ChevronIcon expanded={!collapsed.sources} />
              Sources
            </span>
          </div>
          {!collapsed.sources && sources.map((s) => (
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
            <div className="sidebar-section-title" onClick={() => toggleSection("recent")} style={{ cursor: "pointer" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <ChevronIcon expanded={!collapsed.recent} />
                Recent
              </span>
            </div>
            {!collapsed.recent && recentChats.map((chat) => (
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
