import { useState, useEffect, useCallback, useRef } from "react";
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
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);

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
    const close = () => { setContextMenu(null); setConfirmDeleteId(null); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [contextMenu]);

  useEffect(() => {
    if (renamingId) renameRef.current?.focus();
  }, [renamingId]);

  function handleAction(action: string, tagId: string) {
    const tag = tags.find((t) => t.id === tagId);
    if (action === "rename") {
      setRenamingId(tagId);
      setContextMenu(null);
    } else if (action === "color") {
      // Cycle through preset colors
      const colors = ["#88C0D0", "#81A1C1", "#5E81AC", "#BF616A", "#D08770", "#EBCB8B", "#A3BE8C", "#B48EAD"];
      const currentIdx = colors.indexOf(tag?.color || "");
      const nextColor = colors[(currentIdx + 1) % colors.length];
      onUpdateTag(tagId, { color: nextColor });
      setContextMenu(null);
    } else if (action === "child") {
      onCreateTag("New Tag", tagId);
      setExpandedIds((prev) => new Set(prev).add(tagId));
      setContextMenu(null);
    } else if (action === "delete") {
      if (confirmDeleteId === tagId) {
        if (selectedTagIds.has(tagId) && selectedTagIds.size > 1) {
          for (const id of selectedTagIds) {
            onDeleteTag(id);
          }
        } else {
          onDeleteTag(tagId);
        }
        setConfirmDeleteId(null);
        setContextMenu(null);
      } else {
        setConfirmDeleteId(tagId);
        return; // keep menu open
      }
    } else {
      setContextMenu(null);
    }
  }

  function renderTag(tag: TagWithCount): React.ReactNode {
    const expanded = expandedIds.has(tag.id);
    const hasChildren = (tag.children?.length ?? 0) > 0;
    const isRenaming = renamingId === tag.id;

    return (
      <div key={tag.id}>
        <div
          className={`tag-tree-node ${selectedTagIds.has(tag.id) ? "active" : ""}`}
          onClick={(e) => {
            if (isRenaming) return;
            if (e.metaKey || e.ctrlKey) {
              onToggle(tag.id);
            } else {
              onSelect(tag.id);
            }
          }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, tagId: tag.id }); }}
        >
          {hasChildren && (
            <svg className={`tag-tree-chevron ${expanded ? "expanded" : ""}`} viewBox="0 0 20 20" fill="currentColor"
              onClick={(e) => { e.stopPropagation(); toggleExpand(tag.id); }}>
              <path d="M6 4l8 6-8 6V4z" />
            </svg>
          )}
          <span className="dot" style={{ backgroundColor: tag.color || "#88C0D0" }} />
          {isRenaming ? (
            <input
              ref={renameRef}
              className="inline-create-input"
              defaultValue={tag.name}
              autoComplete="off" autoCorrect="off" spellCheck={false}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const val = (e.target as HTMLInputElement).value.trim();
                  if (val) onUpdateTag(tag.id, { name: val });
                  setRenamingId(null);
                } else if (e.key === "Escape") {
                  setRenamingId(null);
                }
              }}
              onBlur={(e) => {
                const val = e.target.value.trim();
                if (val && val !== tag.name) onUpdateTag(tag.id, { name: val });
                setRenamingId(null);
              }}
              style={{ flex: 1, minWidth: 0 }}
            />
          ) : (
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tag.name}</span>
          )}
          {tag.chat_count > 0 && !isRenaming && <span className="folder-badge">{tag.chat_count}</span>}
        </div>
        {expanded && hasChildren && (
          <div className="tag-tree-children">
            {tag.children!.map((child) => renderTag(child))}
          </div>
        )}
      </div>
    );
  }

  function getDeleteLabel(): string {
    if (contextMenu && selectedTagIds.has(contextMenu.tagId) && selectedTagIds.size > 1) {
      const prefix = confirmDeleteId === contextMenu.tagId ? "Confirm delete" : "Delete";
      return `${prefix} ${selectedTagIds.size} tags`;
    }
    return confirmDeleteId === contextMenu?.tagId ? "Confirm delete" : "Delete";
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
          <button className="danger" onClick={(e) => { e.stopPropagation(); handleAction("delete", contextMenu.tagId); }}>
            {getDeleteLabel()}
          </button>
        </div>
      )}
    </>
  );
}
