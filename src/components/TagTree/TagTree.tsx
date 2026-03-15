import { useState, useEffect, useCallback } from 'react';
import type { Tag, TagWithCount } from '../../types';

interface TagTreeProps {
  tags: TagWithCount[];
  selectedTagId: string | null;
  onSelect: (tagId: string | null) => void;
  onCreateTag: (name: string, parentId?: string, color?: string) => void;
  onUpdateTag: (id: string, updates: Partial<Tag>) => void;
  onDeleteTag: (id: string) => void;
}

function buildTree(tags: TagWithCount[]): TagWithCount[] {
  const map = new Map<string, TagWithCount>();
  const roots: TagWithCount[] = [];
  tags.forEach(t => map.set(t.id, { ...t, children: [] }));
  map.forEach(t => {
    if (t.parent_id && map.has(t.parent_id)) {
      map.get(t.parent_id)!.children!.push(t);
    } else {
      roots.push(t);
    }
  });
  return roots;
}

interface ContextMenuState {
  x: number;
  y: number;
  tagId: string;
}

export function TagTree({
  tags,
  selectedTagId,
  onSelect,
  onCreateTag,
  onUpdateTag,
  onDeleteTag,
}: TagTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const tree = buildTree(tags);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [contextMenu]);

  function handleRename(tagId: string) {
    const tag = tags.find(t => t.id === tagId);
    const name = window.prompt('Rename tag:', tag?.name || '');
    if (name?.trim()) {
      onUpdateTag(tagId, { name: name.trim() });
    }
    setContextMenu(null);
  }

  function handleChangeColor(tagId: string) {
    const tag = tags.find(t => t.id === tagId);
    const color = window.prompt('Enter hex color:', tag?.color || '#88C0D0');
    if (color?.trim()) {
      onUpdateTag(tagId, { color: color.trim() });
    }
    setContextMenu(null);
  }

  function handleCreateChild(tagId: string) {
    const name = window.prompt('Child tag name:');
    if (name?.trim()) {
      onCreateTag(name.trim(), tagId);
    }
    setContextMenu(null);
  }

  function handleDelete(tagId: string) {
    const tag = tags.find(t => t.id === tagId);
    if (window.confirm(`Delete tag "${tag?.name}"?`)) {
      onDeleteTag(tagId);
    }
    setContextMenu(null);
  }

  function renderTag(tag: TagWithCount): React.ReactNode {
    const expanded = expandedIds.has(tag.id);
    const hasChildren = (tag.children?.length ?? 0) > 0;

    function handleContextMenu(e: React.MouseEvent) {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, tagId: tag.id });
    }

    return (
      <div key={tag.id}>
        <div
          onClick={() => onSelect(tag.id)}
          onContextMenu={handleContextMenu}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded cursor-pointer text-sm transition-colors group
            ${selectedTagId === tag.id ? 'bg-nord-2 text-nord-8' : 'text-nord-4 hover:text-nord-6 hover:bg-nord-2/50'}`}
        >
          {hasChildren && (
            <button
              onClick={e => {
                e.stopPropagation();
                toggleExpand(tag.id);
              }}
              className="text-nord-3 hover:text-nord-6"
            >
              <svg
                className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M6 4l8 6-8 6V4z" />
              </svg>
            </button>
          )}
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: tag.color || '#88C0D0' }}
          />
          <span className="truncate flex-1">{tag.name}</span>
          <span className="text-xs text-nord-3">{tag.chat_count}</span>
        </div>
        {expanded && hasChildren && (
          <div className="ml-3 border-l border-nord-3/30 pl-1">
            {tag.children!.map(child => renderTag(child))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {tree.map(tag => renderTag(tag))}

      {contextMenu && (
        <div
          style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 50 }}
          className="bg-nord-1 border border-nord-3 rounded shadow-lg py-1 min-w-[140px]"
        >
          <button
            onClick={() => handleRename(contextMenu.tagId)}
            className="w-full text-left px-3 py-1.5 text-sm text-nord-4 hover:bg-nord-2 hover:text-nord-6"
          >
            Rename
          </button>
          <button
            onClick={() => handleChangeColor(contextMenu.tagId)}
            className="w-full text-left px-3 py-1.5 text-sm text-nord-4 hover:bg-nord-2 hover:text-nord-6"
          >
            Change Color
          </button>
          <button
            onClick={() => handleCreateChild(contextMenu.tagId)}
            className="w-full text-left px-3 py-1.5 text-sm text-nord-4 hover:bg-nord-2 hover:text-nord-6"
          >
            Create Child
          </button>
          <div className="border-t border-nord-3 my-1" />
          <button
            onClick={() => handleDelete(contextMenu.tagId)}
            className="w-full text-left px-3 py-1.5 text-sm text-nord-11 hover:bg-nord-2 hover:text-nord-11"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
