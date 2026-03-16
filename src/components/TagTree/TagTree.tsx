import { useState, useEffect, useCallback } from "react";
import type { Tag, TagWithCount } from "../../types";

interface TagTreeProps {
  tags: TagWithCount[];
  selectedTagIds: Set<string>;
  onToggle: (tagId: string) => void;
  onSelect: (tagId: string) => void;
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

export function TagTree({ tags, selectedTagIds, onToggle, onSelect, onCreateTag, onUpdateTag, onDeleteTag }: TagTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tagId: string } | null>(null);

  const tree = buildTree(tags);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [contextMenu]);

  function handleAction(action: string, tagId: string) {
    const tag = tags.find((t) => t.id === tagId);
    if (action === "rename") {
      const name = window.prompt("Rename tag:", tag?.name || "");
      if (name?.trim()) onUpdateTag(tagId, { name: name.trim() });
    } else if (action === "color") {
      const color = window.prompt("Hex color:", tag?.color || "#88C0D0");
      if (color?.trim()) onUpdateTag(tagId, { color: color.trim() });
    } else if (action === "child") {
      const name = window.prompt("Child tag name:");
      if (name?.trim()) onCreateTag(name.trim(), tagId);
    } else if (action === "delete") {
      if (window.confirm(`Delete tag "${tag?.name}"?`)) onDeleteTag(tagId);
    }
    setContextMenu(null);
  }

  function renderTag(tag: TagWithCount): React.ReactNode {
    const expanded = expandedIds.has(tag.id);
    const hasChildren = (tag.children?.length ?? 0) > 0;

    return (
      <div key={tag.id}>
        <div
          className={`tag-tree-node ${selectedTagIds.has(tag.id) ? "active" : ""}`}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey) {
              onToggle(tag.id);
            } else {
              onSelect(tag.id);
            }
          }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, tagId: tag.id }); }}
        >
          {hasChildren ? (
            <svg className={`tag-tree-chevron ${expanded ? "expanded" : ""}`} viewBox="0 0 20 20" fill="currentColor"
              onClick={(e) => { e.stopPropagation(); toggleExpand(tag.id); }}>
              <path d="M6 4l8 6-8 6V4z" />
            </svg>
          ) : (
            <span style={{ width: 12 }} />
          )}
          <span className="dot" style={{ backgroundColor: tag.color || "#88C0D0" }} />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tag.name}</span>
          {tag.chat_count > 0 && <span className="count">{tag.chat_count}</span>}
        </div>
        {expanded && hasChildren && (
          <div className="tag-tree-children">
            {tag.children!.map((child) => renderTag(child))}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {tree.map((tag) => renderTag(tag))}
      {contextMenu && (
        <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button onClick={() => handleAction("rename", contextMenu.tagId)}>Rename</button>
          <button onClick={() => handleAction("color", contextMenu.tagId)}>Change Color</button>
          <button onClick={() => handleAction("child", contextMenu.tagId)}>Create Child</button>
          <div className="divider" />
          <button className="danger" onClick={() => handleAction("delete", contextMenu.tagId)}>Delete</button>
        </div>
      )}
    </>
  );
}
