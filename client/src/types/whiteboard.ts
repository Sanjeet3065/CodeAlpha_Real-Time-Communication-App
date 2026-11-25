export type WhiteboardElementType =
  | 'pen'
  | 'highlighter'
  | 'rect'
  | 'circle'
  | 'line'
  | 'arrow'
  | 'text';

export type WhiteboardTool =
  | WhiteboardElementType
  | 'eraser'
  | 'select'
  | 'pan';

export interface WhiteboardPoint {
  x: number;
  y: number;
}

export interface WhiteboardElement {
  id: string;
  type: WhiteboardElementType;
  points?: WhiteboardPoint[];
  x: number;
  y: number;
  width?: number;
  height?: number;
  x2?: number;
  y2?: number;
  text?: string;
  fontSize?: number;
  strokeColor: string;
  fillColor?: string;
  strokeWidth: number;
  opacity?: number;
  zIndex: number;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  isDeleted?: boolean;
}

export interface WhiteboardOperation {
  operationId: string;
  type: 'add' | 'update' | 'delete' | 'clear' | 'undo' | 'redo';
  elementId?: string;
  element?: Partial<WhiteboardElement>;
  previousElement?: Partial<WhiteboardElement>;
  sequence?: number;
}

export interface WhiteboardStateDto {
  meetingId: string;
  version: number;
  elements: WhiteboardElement[];
  lastModifiedBy?: string | null;
  lastModifiedByName?: string | null;
  lastClearedAt?: string | null;
  elementCount: number;
  updatedAt: string;
}

export interface WhiteboardCursor {
  userId: string;
  userName: string;
  x: number;
  y: number;
  tool?: string;
  color?: string;
  lastUpdated: number;
}

export interface WhiteboardBroadcastPayload {
  meetingId: string;
  version: number;
  operations: WhiteboardOperation[];
  userId?: string;
  userName?: string;
}

export interface WhiteboardClearPayload {
  meetingId: string;
  version: number;
  clearedBy: string;
  clearedByName: string;
  clearedAt: string;
}

export interface WhiteboardUndoRedoPayload {
  meetingId: string;
  version: number;
  userId: string;
  elementId: string;
  operationType: 'undo' | 'redo';
  element?: WhiteboardElement;
}
