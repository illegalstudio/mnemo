// Shared drag state — module-level so it's accessible across components
// HTML5 dataTransfer.getData() is not readable during dragover, only on drop
// So we use this shared state to communicate what's being dragged

export type DragPayload =
  | { type: "chat"; chatId: string }
  | { type: "folder"; folderId: string }
  | null;

let current: DragPayload = null;

export function setDragPayload(payload: DragPayload) {
  current = payload;
}

export function getDragPayload(): DragPayload {
  return current;
}

export function clearDragPayload() {
  current = null;
}
