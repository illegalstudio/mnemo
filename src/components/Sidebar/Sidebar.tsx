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

const sources: { value: Source | null; label: string; icon: string }[] = [
  { value: null, label: "All Sources", icon: "M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" },
  { value: "claude", label: "Claude", icon: "M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" },
  { value: "perplexity", label: "Perplexity", icon: "M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" },
  { value: "chatgpt", label: "ChatGPT", icon: "M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" },
  { value: "other", label: "Other", icon: "M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" },
];

const tagColors = ["#88C0D0", "#81A1C1", "#5E81AC", "#BF616A", "#D08770", "#EBCB8B", "#A3BE8C", "#B48EAD"];

export function Sidebar({
  tags,
  selectedTagId,
  selectedSource,
  searchQuery,
  recentChats,
  onSearch,
  onSelectTag,
  onSelectSource,
  onSelectChat,
  onCreateTag,
  onUpdateTag,
  onDeleteTag,
}: SidebarProps) {
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const debouncedSearch = useDebounce(localSearch, 300);

  useEffect(() => {
    onSearch(debouncedSearch);
  }, [debouncedSearch, onSearch]);

  function handleCreateTag() {
    const name = window.prompt("Tag name:");
    if (name?.trim()) {
      const color = tagColors[Math.floor(Math.random() * tagColors.length)];
      onCreateTag(name.trim(), undefined, color);
    }
  }

  return (
    <aside className="w-[252px] min-w-[252px] h-full flex flex-col bg-[#2a2f3a] relative noise-bg">
      {/* App header — draggable titlebar region */}
      <div
        data-tauri-drag-region
        className="relative z-10 px-5 pt-5 pb-3 select-none"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-nord-8 to-nord-10 flex items-center justify-center shadow-md shadow-nord-8/10">
            <svg className="w-3.5 h-3.5 text-nord-0" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          </div>
          <h1 className="text-base text-nord-6 tracking-[0.08em] font-display">
            Mnemo
          </h1>
        </div>
      </div>

      {/* Search */}
      <div className="relative z-10 px-4 pb-3">
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-nord-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            placeholder="Search archive..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="w-full bg-nord-0/50 border border-nord-2/60 rounded-lg pl-8 pr-3 py-[7px] text-[13px] text-nord-5 placeholder:text-nord-3/70 focus:outline-none focus:border-nord-8/50 focus:bg-nord-0/70 transition-all duration-200"
          />
        </div>
      </div>

      {/* Scrollable sections */}
      <div className="relative z-10 flex-1 overflow-y-auto px-4 space-y-5 pb-4">
        {/* Tags */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] font-semibold text-nord-3 uppercase tracking-[0.12em]">
              Tags
            </h3>
            <button
              onClick={handleCreateTag}
              className="text-nord-3 hover:text-nord-8 transition-colors duration-200"
              title="New tag"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
          </div>
          <TagTree
            tags={tags}
            selectedTagId={selectedTagId}
            onSelect={onSelectTag}
            onCreateTag={onCreateTag}
            onUpdateTag={onUpdateTag}
            onDeleteTag={onDeleteTag}
          />
          {tags.length === 0 && (
            <p className="text-[11px] text-nord-3/60 italic pl-1">No tags yet</p>
          )}
        </section>

        {/* Sources */}
        <section>
          <h3 className="text-[10px] font-semibold text-nord-3 uppercase tracking-[0.12em] mb-2">
            Sources
          </h3>
          <div className="space-y-[2px]">
            {sources.map((s) => (
              <button
                key={String(s.value)}
                onClick={() => onSelectSource(s.value)}
                className={`w-full flex items-center gap-2 px-2.5 py-[6px] rounded-md text-[12.5px] transition-all duration-200 group ${
                  selectedSource === s.value
                    ? "bg-nord-8/10 text-nord-8"
                    : "text-nord-4/80 hover:text-nord-5 hover:bg-white/[0.03]"
                }`}
              >
                <svg className={`w-3.5 h-3.5 flex-shrink-0 ${selectedSource === s.value ? "text-nord-8" : "text-nord-3 group-hover:text-nord-4"}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d={s.icon} />
                </svg>
                {s.label}
              </button>
            ))}
          </div>
        </section>

        {/* Recent */}
        {recentChats.length > 0 && (
          <section>
            <h3 className="text-[10px] font-semibold text-nord-3 uppercase tracking-[0.12em] mb-2">
              Recent
            </h3>
            <div className="space-y-[2px]">
              {recentChats.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => onSelectChat(chat)}
                  className="w-full text-left px-2.5 py-[5px] rounded-md text-[12px] text-nord-4/70 hover:text-nord-5 hover:bg-white/[0.03] truncate transition-all duration-200 leading-snug"
                >
                  {chat.title}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Subtle right border with gradient */}
      <div className="absolute right-0 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-nord-2/60 to-transparent" />
    </aside>
  );
}
