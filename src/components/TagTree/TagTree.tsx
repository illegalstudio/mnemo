import { useState, useEffect, useCallback } from "react";
import type { Tag, TagWithCount } from "../../types";

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
  tags.forEach((t) => map.set(t.id, { ...t, children: [] }));
  map.forEach((t) => {
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
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [contextMenu]);

  function handleRename(tagId: string) {
    const tag = tags.find((t) => t.id === tagId);
    const name = window.prompt("Rename tag:", tag?.name || "");
    if (name?.trim()) onUpdateTag(tagId, { name: name.trim() });
    setContextMenu(null);
  }

  function handleChangeColor(tagId: string) {
    const tag = tags.find((t) => t.id === tagId);
    const color = window.prompt("Enter hex color:", tag?.color || "#88C0D0");
    if (color?.trim()) onUpdateTag(tagId, { color: color.trim() });
    setContextMenu(null);
  }

  function handleCreateChild(tagId: string) {
    const name = window.prompt("Child tag name:");
    if (name?.trim()) onCreateTag(name.trim(), tagId);
    setContextMenu(null);
  }

  function handleDelete(tagId: string) {
    const tag = tags.find((t) => t.id === tagId);
    if (window.confirm(`Delete tag "${tag?.name}"?`)) onDeleteTag(tagId);
    setContextMenu(null);
  }

  function renderTag(tag: TagWithCount, depth = 0): React.ReactNode {
    const expanded = expandedIds.has(tag.id);
    const hasChildren = (tag.children?.length ?? 0) > 0;
    const isSelected = selectedTagId === tag.id;

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
          className={`flex items-center gap-[6px] px-2 py-[4px] rounded-md cursor-pointer text-[12.5px] transition-all duration-150 group
            ${isSelected
              ? "bg-nord-8/12 text-nord-8"
              : "text-nord-4/80 hover:text-nord-5 hover:bg-white/[0.03]"
            }`}
        >
          {/* Expand toggle */}
          <span className="w-3 flex items-center justify-center flex-shrink-0">
            {hasChildren ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(tag.id);
                }}
                className="text-nord-3 hover:text-nord-5 transition-colors"
              >
                <svg
                  className={`w-2.5 h-2.5 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M6 4l8 6-8 6V4z" />
                </svg>
              </button>
            ) : null}
          </span>

          {/* Color dot */}
          <span
            className="w-[7px] h-[7px] rounded-full flex-shrink-0 ring-1 ring-white/10"
            style={{ backgroundColor: tag.color || "#88C0D0" }}
          />

          {/* Name */}
          <span className="truncate flex-1 leading-tight">{tag.name}</span>

          {/* Count */}
          {tag.chat_count > 0 && (
            <span className={`text-[10px] tabular-nums ${isSelected ? "text-nord-8/60" : "text-nord-3/60"}`}>
              {tag.chat_count}
            </span>
          )}
        </div>

        {/* Children */}
        {expanded && hasChildren && (
          <div className="ml-[14px] mt-[1px] pl-[10px] border-l border-nord-2/30">
            {tag.children!.map((child) => renderTag(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-[1px]">
      {tree.map((tag) => renderTag(tag))}

      {/* Context menu */}
      {contextMenu && (
        <div
          style={{ position: "fixed", left: contextMenu.x, top: contextMenu.y, zIndex: 100 }}
          className="bg-[#2f3541] border border-nord-2/80 rounded-lg shadow-xl shadow-black/30 py-1 min-w-[150px] animate-fade-in"
        >
          <button
            onClick={() => handleRename(contextMenu.tagId)}
            className="w-full text-left px-3 py-[6px] text-[12px] text-nord-4 hover:bg-white/[0.05] hover:text-nord-6 transition-colors"
          >
            Rename
          </button>
          <button
            onClick={() => handleChangeColor(contextMenu.tagId)}
            className="w-full text-left px-3 py-[6px] text-[12px] text-nord-4 hover:bg-white/[0.05] hover:text-nord-6 transition-colors"
          >
            Change Color
          </button>
          <button
            onClick={() => handleCreateChild(contextMenu.tagId)}
            className="w-full text-left px-3 py-[6px] text-[12px] text-nord-4 hover:bg-white/[0.05] hover:text-nord-6 transition-colors"
          >
            Create Child
          </button>
          <div className="border-t border-nord-2/50 my-1" />
          <button
            onClick={() => handleDelete(contextMenu.tagId)}
            className="w-full text-left px-3 py-[6px] text-[12px] text-nord-11/80 hover:bg-nord-11/10 hover:text-nord-11 transition-colors"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
