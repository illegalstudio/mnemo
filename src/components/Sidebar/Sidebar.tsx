import { useState, useEffect } from 'react';
import type { Chat, Source, Tag, TagWithCount } from '../../types';
import { TagTree } from '../TagTree/TagTree';
import { useDebounce } from '../../hooks/useDebounce';

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
  { value: null, label: 'All' },
  { value: 'claude', label: 'Claude' },
  { value: 'perplexity', label: 'Perplexity' },
  { value: 'chatgpt', label: 'ChatGPT' },
  { value: 'other', label: 'Other' },
];

const nordColors = ['#88C0D0', '#81A1C1', '#5E81AC', '#BF616A', '#D08770', '#EBCB8B', '#A3BE8C', '#B48EAD'];

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
    const name = window.prompt('Tag name:');
    if (name?.trim()) {
      const color = nordColors[Math.floor(Math.random() * nordColors.length)];
      onCreateTag(name.trim(), undefined, color);
    }
  }

  return (
    <aside className="w-[250px] min-w-[250px] h-full bg-nord-1 border-r border-nord-2 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-nord-2">
        <h1 className="text-lg font-bold text-nord-8 tracking-wide">Mnemo</h1>
      </div>

      {/* Search */}
      <div className="p-3">
        <input
          type="text"
          placeholder="Search chats..."
          value={localSearch}
          onChange={e => setLocalSearch(e.target.value)}
          className="w-full bg-nord-0 border border-nord-3 rounded px-3 py-1.5 text-sm text-nord-6 placeholder-nord-3 focus:outline-none focus:border-nord-8 transition-colors"
        />
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-3">
        {/* Tags section */}
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-nord-4 uppercase tracking-wider mb-2">Tags</h3>
          <TagTree
            tags={tags}
            selectedTagId={selectedTagId}
            onSelect={onSelectTag}
            onCreateTag={onCreateTag}
            onUpdateTag={onUpdateTag}
            onDeleteTag={onDeleteTag}
          />
          <button
            onClick={() => handleCreateTag()}
            className="text-xs text-nord-8 hover:text-nord-7 mt-2 transition-colors"
          >
            + New Tag
          </button>
        </div>

        {/* Sources section */}
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-nord-4 uppercase tracking-wider mb-2">Sources</h3>
          <div className="space-y-0.5">
            {sources.map(s => (
              <button
                key={String(s.value)}
                onClick={() => onSelectSource(s.value)}
                className={`w-full text-left px-2 py-1 rounded text-sm transition-colors ${
                  selectedSource === s.value
                    ? 'bg-nord-2 text-nord-8'
                    : 'text-nord-4 hover:text-nord-6 hover:bg-nord-2/50'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Recent section */}
        <div className="mb-4">
          <h3 className="text-xs font-semibold text-nord-4 uppercase tracking-wider mb-2">Recent</h3>
          <div className="space-y-0.5">
            {recentChats.map(chat => (
              <button
                key={chat.id}
                onClick={() => onSelectChat(chat)}
                className="w-full text-left px-2 py-1 rounded text-sm text-nord-4 hover:text-nord-6 hover:bg-nord-2/50 truncate transition-colors"
              >
                {chat.title}
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
