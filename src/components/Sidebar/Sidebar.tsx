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
  trashCount: number;
  onShowTrash: () => void;
  activeFilters: ActiveFilters;
  onSetFilters: (filters: ActiveFilters) => void;
  onOpenSettings: () => void;
  onImportClick: () => void;
  onRefresh: () => void;
}

export interface ActiveFilters {
  favorites: boolean;
  hasAttachment: boolean;
  hasSummary: boolean;
  createdAfter: string; // ISO date or ""
  createdBefore: string; // ISO date or ""
}

const sources: { value: Source | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "claude", label: "Claude" },
  { value: "perplexity", label: "Perplexity" },
  { value: "chatgpt", label: "ChatGPT" },
  { value: "grok", label: "Grok" },
  { value: "other", label: "Other" },
];

const sourceColors: Record<string, string> = {
  claude: "var(--source-claude)",
  perplexity: "var(--source-perplexity)",
  chatgpt: "var(--source-chatgpt)",
  grok: "var(--source-grok)",
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
  trashCount, onShowTrash, activeFilters, onSetFilters,
  onOpenSettings, onImportClick, onRefresh,
}: SidebarProps) {
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const debouncedSearch = useDebounce(localSearch, 300);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);
  const [creatingTag, setCreatingTag] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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
            <svg width="15" height="15" viewBox="-0.18 0 28.03 28.03" fill="white">
              <path d="m27.46,14.89c.4-1.17.17-2.43-.6-3.37.26-.64.54-1.73.05-2.91-.28-.68-.77-1.22-1.36-1.62-.1-.7-.4-1.84-1.38-2.67-.84-.72-1.97-1.03-3.12-.94-.2-.48-.54-1.05-1.15-1.53-1.06-.83-2.23-.84-2.89-.76-.63-.49-2.15-1.45-4.01-.96-1.1.29-1.83.94-2.27,1.47-.96-.09-3.1-.05-4.59,1.63-.38.43-.64.89-.83,1.33-1.89-.06-3.64.91-4.43,2.5-.71,1.45-.37,2.89-.11,3.61-.55.85-1.09,2.33-.55,3.87.3.85.82,1.45,1.3,1.84-.21.27-.42.59-.6,1.1-.15.43-.55,1.56,0,2.73.44.95,1.26,1.43,1.74,1.64.08.83.45,1.61,1.11,2.14.54.44,1.23.67,1.95.67.28,0,.57-.05.86-.12.05.06.1.12.16.18.81.78,1.87,1.18,2.94,1.18.08,0,.16-.02.25-.02.33.6,1.16,1.77,2.76,2.07.24.05.49.07.73.07,1.22,0,2.4-.57,3.15-1.56.1-.13.17-.26.24-.39.26.05.6.1.99.1.74,0,1.63-.16,2.41-.75.82-.62,1.21-1.46,1.37-1.91.11-.32.16-.61.19-.87.2.03.4.04.61.04,1.33,0,2.61-.59,3.47-1.66,1.06-1.31,1.26-3.08.59-4.6.48-.4.85-.92,1.06-1.53Zm-22.75,7.96c-.6-.48-.83-1.6-.17-2.55.23-.34.15-.81-.19-1.04-.34-.23-.81-.15-1.04.19-.18.27-.31.55-.42.84-.22-.15-.46-.36-.6-.68-.29-.63-.05-1.29.06-1.61.13-.37.28-.56.48-.82.13-.16.27-.35.41-.59,0,0,0,0,0,0,0,0,0,0,0,0,.1-.17.2-.36.3-.59.25-.63.38-1.31.37-2.03,0-.41-.34-.74-.75-.74h-.01c-.41,0-.75.35-.74.76,0,.37-.06.72-.15,1.06-.24-.24-.47-.56-.62-.97-.51-1.46.56-2.79.57-2.8.19-.23.22-.54.09-.81-.12-.24-.67-1.5-.07-2.72.48-.98,1.53-1.59,2.7-1.66,0,.06-.01.13-.02.19-.03.41.29.77.7.8.02,0,.03,0,.05,0,.39,0,.72-.3.75-.7.03-.47.18-1.37.85-2.13,1.36-1.53,3.64-1.09,3.66-1.09.3.06.61-.07.78-.32.19-.29.74-.99,1.68-1.24,1.58-.41,2.87.83,2.89.84.18.18.45.26.7.2.19-.04,1.19-.23,2.01.41.27.21.45.46.58.69-.29.11-.58.24-.85.4-.75-.3-2.3-.71-3.99.03-1.06.47-1.75,1.21-2.18,1.87-.2-.23-.44-.46-.74-.66-.92-.61-1.86-.65-2.34-.61-.41.03-.73.39-.7.8.03.41.42.72.8.7.29-.02.86,0,1.41.37.19.13.34.27.46.42-1.27.31-2.37,1.04-3.01,2.14-.64,1.1-.63,2.26-.52,3.03-.15.08-.31.18-.48.29-.22-.14-.4-.29-.49-.47-.11-.21-.12-.4-.12-.73,0-.39-.01-.88-.31-1.41-.29-.52-.76-.93-1.4-1.22-.38-.17-.82,0-.99.38-.17.38,0,.82.38.99.33.15.57.34.69.56.11.2.12.39.12.72,0,.39.02.87.3,1.4.16.31.4.58.69.81-.22.27-.42.57-.59.93-.73,1.56-.58,3.4.38,4.93-.71,1.14-.81,2.53-.36,3.75-.38,0-.74-.1-1-.32Zm19.94-2.76c-.69.86-1.79,1.25-2.86,1.04.02-.16.06-.33.12-.51.12-.34.3-.66.54-.95.26-.32.22-.79-.1-1.06-.32-.26-.79-.22-1.06.1-.35.42-.62.9-.8,1.4-.26.73-.25,1.29-.23,1.78,0,.4.02.72-.12,1.13-.08.23-.33.81-.85,1.21-.66.49-1.47.49-2.01.42.1-.83-.06-1.51-.12-1.7-.12-.4-.53-.62-.93-.5-.4.12-.62.54-.5.93.04.12.35,1.25-.37,2.2-.55.73-1.49,1.08-2.39.92-.75-.14-1.22-.6-1.5-.98.33-.15.65-.33.94-.57.32-.26.37-.74.1-1.06s-.74-.37-1.06-.1c-1.09.89-2.67.84-3.67-.12-1.03-.99-1.12-2.64-.2-3.76.22-.27.23-.66.01-.93-.9-1.16-1.1-2.63-.53-3.84.53-1.12,1.55-1.61,1.97-1.77.36-.14.56-.53.46-.91-.12-.43-.34-1.52.23-2.51.55-.95,1.64-1.51,2.87-1.55,0,0,0,0,.01,0,0,0,0,0,0,0,.4-.01.82.03,1.24.14.4.1.81-.14.91-.54.1-.4-.14-.81-.54-.91-.17-.04-.34-.06-.51-.09.3-.5.79-1.08,1.61-1.44,1.53-.68,2.95.02,3.1.11.25.13.54.11.77-.05,1.34-.92,3.02-.97,4-.13.31.27.51.59.64.9-.25-.03-.5-.05-.75-.03-.41.03-.73.38-.7.8.03.41.39.72.8.7,1.04-.07,1.99.48,2.36,1.36.42,1-.14,1.97-.21,2.07-.19.31-.13.71.14.96.62.55.85,1.4.58,2.18-.26.75-.94,1.28-1.74,1.35-.41.04-.72.4-.68.81.03.39.36.69.75.69.02,0,.04,0,.07,0,.22-.02.43-.06.64-.12.4.99.25,2.12-.43,2.96Z" />
              <path d="m18.95,16.66c-.41-.07-1.85-.24-3.18.74-.69.5-1.1,1.13-1.34,1.67-.55-.24-1.3-.42-2.16-.17-1.35.38-1.93,1.49-2.08,1.82-.17.38,0,.82.39.99.1.04.2.06.3.06.29,0,.56-.17.69-.45.04-.08.36-.77,1.11-.98.91-.25,1.64.4,1.66.43.2.19.5.25.75.16.26-.09.45-.32.5-.59.04-.25.24-1.12,1.06-1.72.85-.62,1.77-.51,2.04-.47.41.08.8-.2.87-.61.07-.41-.2-.8-.61-.87Z" />
              <path d="m12.04,17.25c.13,0,.26-.03.38-.1.36-.21.47-.67.26-1.03-.1-.17-.32-.61-.19-1.1.08-.31.29-.58.6-.8.28-.19.52-.22.83-.26.4-.05.89-.11,1.36-.54.48-.43.74-1.08.77-1.91.02-.41-.3-.76-.72-.78-.38-.04-.76.3-.78.72-.01.29-.07.68-.28.87-.11.1-.22.12-.54.16-.38.05-.91.12-1.49.51-.61.42-1.02.99-1.2,1.64-.28,1.04.15,1.92.34,2.25.14.24.39.37.65.37Z" />
              <path d="m22.84,12.1c-.14-.09-.66-.38-1.38-.48-.02-.71-.21-1.94-1.26-2.85-.98-.85-2.12-.91-2.58-.9-.41.01-.74.36-.73.77.01.41.35.69.77.73.28,0,.97.03,1.55.53.69.6.76,1.48.75,1.87-1.38.49-1.92,1.7-2.01,1.94-.15.39.04.82.43.97.09.04.18.05.27.05.3,0,.58-.18.7-.48.03-.08.33-.8,1.12-1.07.8-.28,1.5.13,1.57.18.35.22.81.11,1.03-.24.22-.35.11-.81-.24-1.03Z" />
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
          Import from Markdown
        </button>
        <p style={{ fontSize: 10, color: "var(--text-faint)", lineHeight: 1.4, marginTop: 6, textAlign: "left" }}>
          Or install a bookmarklet from <span style={{ cursor: "pointer", color: "var(--accent)", textDecoration: "underline" }} onClick={onOpenSettings}>Settings</span> to capture chats directly from your browser.
        </p>
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
        {/* Filters */}
        <div className="sidebar-section">
          <div className="sidebar-section-title" onClick={() => toggleSection("filters")} style={{ cursor: "pointer" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <ChevronIcon expanded={!collapsed.filters} />
              Filters
            </span>
            {(activeFilters.favorites || activeFilters.hasAttachment || activeFilters.hasSummary || activeFilters.createdAfter || activeFilters.createdBefore) && (
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
            )}
          </div>
          {!collapsed.filters && (
            <div className="sidebar-filters">
              <label className="sidebar-filter-check">
                <input type="checkbox" checked={activeFilters.favorites} onChange={(e) => onSetFilters({ ...activeFilters, favorites: e.target.checked })} />
                ★ Favorites
              </label>
              <label className="sidebar-filter-check">
                <input type="checkbox" checked={activeFilters.hasAttachment} onChange={(e) => onSetFilters({ ...activeFilters, hasAttachment: e.target.checked })} />
                Has attachment
              </label>
              <label className="sidebar-filter-check">
                <input type="checkbox" checked={activeFilters.hasSummary} onChange={(e) => onSetFilters({ ...activeFilters, hasSummary: e.target.checked })} />
                Has summary
              </label>
              <div className="sidebar-filter-row">
                <label className="sidebar-filter-label">After</label>
                <input type="date" className="sidebar-filter-date" value={activeFilters.createdAfter} onChange={(e) => onSetFilters({ ...activeFilters, createdAfter: e.target.value })} />
              </div>
              <div className="sidebar-filter-row">
                <label className="sidebar-filter-label">Before</label>
                <input type="date" className="sidebar-filter-date" value={activeFilters.createdBefore} onChange={(e) => onSetFilters({ ...activeFilters, createdBefore: e.target.value })} />
              </div>
              {(activeFilters.favorites || activeFilters.hasAttachment || activeFilters.hasSummary || activeFilters.createdAfter || activeFilters.createdBefore) && (
                <button onClick={() => onSetFilters({ favorites: false, hasAttachment: false, hasSummary: false, createdAfter: "", createdBefore: "" })} style={{ border: "none", background: "none", color: "var(--text-faint)", cursor: "pointer", fontSize: 11, padding: "2px 8px" }}>Clear filters</button>
              )}
            </div>
          )}
        </div>

        {/* Folders */}
        <div className="sidebar-section">
          <div className="sidebar-section-title" onClick={() => toggleSection("folders")} style={{ cursor: "pointer" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <ChevronIcon expanded={!collapsed.folders} />
              Folders
              <button onClick={(e) => { e.stopPropagation(); if (refreshing) return; setRefreshing(true); onRefresh(); setTimeout(() => setRefreshing(false), 600); }} style={{ border: "none", background: "none", color: "var(--text-faint)", cursor: "pointer", lineHeight: 1, padding: 0 }} title="Refresh">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={refreshing ? "spin" : ""}><path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 019-9 9.75 9.75 0 016.74 2.74L21 8M3 3v5h5M21 12a9 9 0 01-9 9 9.75 9.75 0 01-6.74-2.74L3 16m18 5v-5h-5" /></svg>
              </button>
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
        {/* Trash */}
        <div className="sidebar-section">
          <button className="sidebar-btn" onClick={onShowTrash} style={{ color: trashCount > 0 ? "var(--text-secondary)" : "var(--text-faint)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
            Trash
            {trashCount > 0 && <span className="folder-badge">{trashCount}</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}
