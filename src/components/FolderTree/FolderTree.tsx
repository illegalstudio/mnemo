import { useState, useEffect, useCallback, useRef } from "react";
import type { FolderWithCount } from "../../types";
import { getDragPayload, setDragPayload, clearDragPayload } from "../../lib/drag-state";

const UNFILED_ID = "__unfiled__";

interface FolderTreeProps {
  folders: FolderWithCount[];
  unfiledCount: number;
  selectedFolderId: string | null;
  onSelect: (folderId: string | null) => void;
  onCreateFolder: (name: string, parentId?: string, color?: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onMoveChatToFolder: (chatId: string, folderId: string | null) => void;
  onMoveFolderToParent: (folderId: string, newParentId: string | null) => Promise<boolean>;
}

function buildTree(folders: FolderWithCount[]): FolderWithCount[] {
  const map = new Map<string, FolderWithCount>();
  const roots: FolderWithCount[] = [];
  folders.forEach((f) => map.set(f.id, { ...f, children: [] }));
  map.forEach((f) => {
    if (f.parent_id && map.has(f.parent_id)) {
      map.get(f.parent_id)!.children!.push(f);
    } else {
      roots.push(f);
    }
  });
  return roots;
}

// Counter per gestire dragenter/dragleave su elementi con figli
// Senza questo, entrare su un figlio genera leave sul padre
const enterCounters = new Map<string, number>();

export function FolderTree({
  folders, unfiledCount, selectedFolderId, onSelect, onCreateFolder, onRenameFolder, onDeleteFolder,
  onMoveChatToFolder, onMoveFolderToParent,
}: FolderTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; folderId: string } | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const tree = buildTree(folders);

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

  function handleAction(action: string, folderId: string) {
    if (action === "rename") {
      setRenamingId(folderId);
    } else if (action === "child") {
      onCreateFolder("New Folder", folderId);
      setExpandedIds((prev) => new Set(prev).add(folderId));
    } else if (action === "delete") {
      if (confirmDeleteId === folderId) {
        onDeleteFolder(folderId);
        setConfirmDeleteId(null);
      } else {
        setConfirmDeleteId(folderId);
        return; // keep context menu open
      }
    } else if (action === "unfile") {
      onMoveFolderToParent(folderId, null);
    }
    setContextMenu(null);
  }

  function handleDragEnter(e: React.DragEvent, folderId: string) {
    e.preventDefault();
    const payload = getDragPayload();
    if (!payload) return;
    // Don't highlight self
    if (payload.type === "folder" && payload.folderId === folderId) return;

    const count = (enterCounters.get(folderId) || 0) + 1;
    enterCounters.set(folderId, count);
    if (count === 1) {
      setDragOverId(folderId);
    }
  }

  function handleDragLeave(e: React.DragEvent, folderId: string) {
    e.preventDefault();
    const count = (enterCounters.get(folderId) || 0) - 1;
    enterCounters.set(folderId, Math.max(0, count));
    if (count <= 0) {
      enterCounters.delete(folderId);
      setDragOverId((prev) => prev === folderId ? null : prev);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(e: React.DragEvent, folderId: string) {
    e.preventDefault();
    e.stopPropagation();
    enterCounters.delete(folderId);
    setDragOverId(null);

    const payload = getDragPayload();
    if (!payload) return;

    if (payload.type === "chat") {
      onMoveChatToFolder(payload.chatId, folderId);
    } else if (payload.type === "folder" && payload.folderId !== folderId) {
      onMoveFolderToParent(payload.folderId, folderId);
    }
  }

  function renderFolder(folder: FolderWithCount, depth: number = 0): React.ReactNode {
    const expanded = expandedIds.has(folder.id);
    const hasChildren = (folder.children?.length ?? 0) > 0;
    const isSelected = selectedFolderId === folder.id;
    const isDragOver = dragOverId === folder.id;
    const isRenaming = renamingId === folder.id;
    const payload = getDragPayload();
    const isDragging = payload?.type === "folder" && payload.folderId === folder.id;

    return (
      <div key={folder.id}>
        <div
          className={`folder-tree-node ${isSelected ? "active" : ""} ${isDragOver ? "drag-over" : ""} ${isDragging ? "dragging" : ""}`}
          onClick={() => { if (!isRenaming) onSelect(isSelected ? null : folder.id); }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, folderId: folder.id }); }}
          onDragEnter={(e) => handleDragEnter(e, folder.id)}
          onDragLeave={(e) => handleDragLeave(e, folder.id)}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, folder.id)}
        >
          {hasChildren ? (
            <svg className={`tag-tree-chevron ${expanded ? "expanded" : ""}`} viewBox="0 0 20 20" fill="currentColor"
              onClick={(e) => { e.stopPropagation(); toggleExpand(folder.id); }}>
              <path d="M6 4l8 6-8 6V4z" />
            </svg>
          ) : (
            <span style={{ width: 12 }} />
          )}
          {/* Folder icon — drag handle for folder nesting */}
          <span
            className="folder-drag-handle"
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              setDragPayload({ type: "folder", folderId: folder.id });
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", folder.id);
            }}
            onDragEnd={() => {
              clearDragPayload();
              setDragOverId(null);
              enterCounters.clear();
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke={folder.color || "var(--text-faint)"} strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
          </span>
          {isRenaming ? (
            <input
              ref={renameRef}
              className="inline-create-input"
              defaultValue={folder.name}
              autoComplete="off" autoCorrect="off" spellCheck={false}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const val = (e.target as HTMLInputElement).value.trim();
                  if (val) onRenameFolder(folder.id, val);
                  setRenamingId(null);
                } else if (e.key === "Escape") {
                  setRenamingId(null);
                }
              }}
              onBlur={(e) => {
                const val = e.target.value.trim();
                if (val && val !== folder.name) onRenameFolder(folder.id, val);
                setRenamingId(null);
              }}
              style={{ flex: 1, minWidth: 0 }}
            />
          ) : (
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{folder.name}</span>
          )}
          {!isRenaming && folder.chat_count > 0 && (
            <span className={`folder-badge ${folder.nested_chat_count > 0 ? "has-nested" : ""}`}>
              {folder.chat_count}
            </span>
          )}
        </div>
        {expanded && hasChildren && (
          <div className="tag-tree-children">
            {folder.children!.map((child) => renderFolder(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  const isUnfiledSelected = selectedFolderId === UNFILED_ID;
  const isUnfiledDragOver = dragOverId === UNFILED_ID;

  function handleUnfiledDragEnter(e: React.DragEvent) {
    e.preventDefault();
    const payload = getDragPayload();
    if (!payload || payload.type !== "chat") return;
    const count = (enterCounters.get(UNFILED_ID) || 0) + 1;
    enterCounters.set(UNFILED_ID, count);
    if (count === 1) setDragOverId(UNFILED_ID);
  }

  function handleUnfiledDragLeave(e: React.DragEvent) {
    e.preventDefault();
    const count = (enterCounters.get(UNFILED_ID) || 0) - 1;
    enterCounters.set(UNFILED_ID, Math.max(0, count));
    if (count <= 0) {
      enterCounters.delete(UNFILED_ID);
      setDragOverId((prev) => prev === UNFILED_ID ? null : prev);
    }
  }

  function handleUnfiledDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    enterCounters.delete(UNFILED_ID);
    setDragOverId(null);
    const payload = getDragPayload();
    if (payload?.type === "chat") {
      onMoveChatToFolder(payload.chatId, null);
    }
  }

  return (
    <>
      {/* No folder — unfiled chats */}
      <div
        className={`folder-tree-node ${isUnfiledSelected ? "active" : ""} ${isUnfiledDragOver ? "drag-over" : ""}`}
        onClick={() => onSelect(isUnfiledSelected ? null : UNFILED_ID)}
        onDragEnter={handleUnfiledDragEnter}
        onDragLeave={handleUnfiledDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleUnfiledDrop}
      >
        <span style={{ width: 12 }} />
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.5 }}>
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          <line x1="9" y1="14" x2="15" y2="14" />
        </svg>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontStyle: "italic", color: "var(--text-muted)" }}>No folder</span>
        {unfiledCount > 0 && <span className="folder-badge">{unfiledCount}</span>}
      </div>
      {tree.map((folder) => renderFolder(folder))}
      {contextMenu && (
        <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button onClick={() => handleAction("rename", contextMenu.folderId)}>Rename</button>
          <button onClick={() => handleAction("child", contextMenu.folderId)}>Create Child</button>
          {folders.find(f => f.id === contextMenu.folderId)?.parent_id && (
            <button onClick={() => handleAction("unfile", contextMenu.folderId)}>Move to Root</button>
          )}
          <div className="divider" />
          <button className="danger" onClick={(e) => { e.stopPropagation(); handleAction("delete", contextMenu.folderId); }}>
            {confirmDeleteId === contextMenu.folderId ? "Confirm delete" : "Delete"}
          </button>
        </div>
      )}
    </>
  );
}
