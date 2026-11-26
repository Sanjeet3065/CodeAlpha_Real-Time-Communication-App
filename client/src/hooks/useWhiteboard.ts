import { useState, useEffect, useCallback, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { whiteboardApi } from '@/services/whiteboardApi';
import {
  sendSocketWhiteboardDraw,
  sendSocketWhiteboardCursor,
  sendSocketWhiteboardUndo,
  sendSocketWhiteboardRedo,
  sendSocketWhiteboardClear,
} from '@/services/meetingSocket';
import type {
  WhiteboardElement,
  WhiteboardTool,
  WhiteboardOperation,
  WhiteboardCursor,
  WhiteboardBroadcastPayload,
  WhiteboardClearPayload,
  WhiteboardUndoRedoPayload,
} from '@/types/whiteboard';

interface UseWhiteboardProps {
  meetingCode: string;
  socket: Socket | null;
  isAdmitted: boolean;
  currentUserId: string;
  currentUserName: string;
  currentUserRole?: string;
}

export function useWhiteboard({
  meetingCode,
  socket,
  isAdmitted,
  currentUserId,
  currentUserName,
  currentUserRole,
}: UseWhiteboardProps) {
  const [elements, setElements] = useState<Map<string, WhiteboardElement>>(new Map());
  const [version, setVersion] = useState<number>(1);
  const [activeTool, setActiveTool] = useState<WhiteboardTool>('pen');
  const [strokeColor, setStrokeColor] = useState<string>('#5FA399');
  const [fillColor, setFillColor] = useState<string | undefined>(undefined);
  const [strokeWidth, setStrokeWidth] = useState<number>(3);
  const [fontSize, setFontSize] = useState<number>(18);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [remoteCursors, setRemoteCursors] = useState<Map<string, WhiteboardCursor>>(new Map());
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const lastCursorBroadcastRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);

  // Load initial board state from server
  const loadBoardState = useCallback(async () => {
    if (!meetingCode || !isAdmitted) return;
    setIsLoading(true);
    try {
      const data = await whiteboardApi.getWhiteboardState(meetingCode);
      if (!isMountedRef.current) return;
      const elementMap = new Map<string, WhiteboardElement>();
      for (const el of data.elements) {
        if (!el.isDeleted) {
          elementMap.set(el.id, el);
        }
      }
      setElements(elementMap);
      setVersion(data.version);
      setError(null);
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load whiteboard state.');
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [meetingCode, isAdmitted]);

  useEffect(() => {
    isMountedRef.current = true;
    void loadBoardState();
    return () => {
      isMountedRef.current = false;
    };
  }, [loadBoardState]);

  // Clean up idle remote cursors (older than 4 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setRemoteCursors((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const [uid, cursor] of next.entries()) {
          if (now - cursor.lastUpdated > 4000) {
            next.delete(uid);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  // Socket.IO Real-Time Event Handlers
  useEffect(() => {
    if (!socket || !isAdmitted) return;

    const handleOperation = (payload: WhiteboardBroadcastPayload) => {
      if (!payload || !Array.isArray(payload.operations)) return;
      setElements((prev) => {
        const next = new Map(prev);
        for (const op of payload.operations) {
          if (!op.elementId) continue;
          if (op.type === 'add' && op.element) {
            next.set(op.elementId, op.element as WhiteboardElement);
          } else if (op.type === 'update' && op.element) {
            const existing = next.get(op.elementId);
            if (existing) {
              next.set(op.elementId, { ...existing, ...(op.element as WhiteboardElement) });
            }
          } else if (op.type === 'delete') {
            next.delete(op.elementId);
          }
        }
        return next;
      });

      if (payload.version) {
        setVersion(payload.version);
      }
    };

    const handleCursor = (cursor: WhiteboardCursor) => {
      if (!cursor || !cursor.userId || cursor.userId === currentUserId) return;
      setRemoteCursors((prev) => {
        const next = new Map(prev);
        next.set(cursor.userId, {
          ...cursor,
          lastUpdated: Date.now(),
        });
        return next;
      });
    };

    const handleUndo = (payload: WhiteboardUndoRedoPayload) => {
      if (!payload || !payload.elementId) return;
      setElements((prev) => {
        const next = new Map(prev);
        if (payload.element && !payload.element.isDeleted) {
          next.set(payload.elementId, payload.element);
        } else {
          next.delete(payload.elementId);
        }
        return next;
      });
      if (payload.version) setVersion(payload.version);
    };

    const handleRedo = (payload: WhiteboardUndoRedoPayload) => {
      if (!payload || !payload.elementId) return;
      setElements((prev) => {
        const next = new Map(prev);
        if (payload.element && !payload.element.isDeleted) {
          next.set(payload.elementId, payload.element);
        } else {
          next.delete(payload.elementId);
        }
        return next;
      });
      if (payload.version) setVersion(payload.version);
    };

    const handleCleared = (payload: WhiteboardClearPayload) => {
      setElements(new Map());
      setSelectedElementId(null);
      if (payload?.version) setVersion(payload.version);
    };

    const handleReconnect = () => {
      // Re-synchronize authoritative board state after socket reconnection
      void loadBoardState();
    };

    socket.on('whiteboard:operation', handleOperation);
    socket.on('whiteboard:cursor', handleCursor);
    socket.on('whiteboard:undo', handleUndo);
    socket.on('whiteboard:redo', handleRedo);
    socket.on('whiteboard:cleared', handleCleared);
    socket.on('connect', handleReconnect);

    return () => {
      socket.off('whiteboard:operation', handleOperation);
      socket.off('whiteboard:cursor', handleCursor);
      socket.off('whiteboard:undo', handleUndo);
      socket.off('whiteboard:redo', handleRedo);
      socket.off('whiteboard:cleared', handleCleared);
      socket.off('connect', handleReconnect);
    };
  }, [socket, isAdmitted, currentUserId, loadBoardState]);

  // Submit an operation (optimistic local update + socket broadcast with REST fallback)
  const submitOperation = useCallback(
    async (op: WhiteboardOperation) => {
      // Optimistic local update
      setElements((prev) => {
        const next = new Map(prev);
        if (op.type === 'add' && op.element && op.elementId) {
          next.set(op.elementId, op.element as WhiteboardElement);
        } else if (op.type === 'update' && op.element && op.elementId) {
          const cur = next.get(op.elementId);
          if (cur) next.set(op.elementId, { ...cur, ...(op.element as WhiteboardElement) });
        } else if (op.type === 'delete' && op.elementId) {
          next.delete(op.elementId);
        }
        return next;
      });

      try {
        if (socket?.connected) {
          const ack = await sendSocketWhiteboardDraw(socket, meetingCode, [op]);
          if (!ack.ok) {
            throw new Error(ack.error || 'Failed to submit drawing operation.');
          }
          if (ack.version) setVersion(ack.version);
        } else {
          // REST Fallback if socket is offline
          const res = await whiteboardApi.submitOperations(meetingCode, [op]);
          if (res.version) setVersion(res.version);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Operation failed.');
        // Re-sync on failure to restore consistency
        void loadBoardState();
      }
    },
    [socket, meetingCode, loadBoardState]
  );

  // Broadcast ephemeral cursor movements (throttled to at most once per 60ms)
  const broadcastCursor = useCallback(
    (canvasX: number, canvasY: number) => {
      if (!socket?.connected) return;
      const now = Date.now();
      if (now - lastCursorBroadcastRef.current < 60) return;
      lastCursorBroadcastRef.current = now;

      sendSocketWhiteboardCursor(socket, meetingCode, {
        x: canvasX,
        y: canvasY,
        tool: activeTool,
        color: strokeColor,
      });
    },
    [socket, meetingCode, activeTool, strokeColor]
  );

  // Add Element Helper
  const addElement = useCallback(
    (newEl: WhiteboardElement) => {
      const operationId = `op_add_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      if (!newEl.createdByName) {
        newEl.createdByName = currentUserName;
      }
      void submitOperation({
        operationId,
        type: 'add',
        elementId: newEl.id,
        element: newEl,
      });
    },
    [submitOperation, currentUserName]
  );

  // Update Element Helper
  const updateElement = useCallback(
    (id: string, updates: Partial<WhiteboardElement>) => {
      const operationId = `op_upd_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      void submitOperation({
        operationId,
        type: 'update',
        elementId: id,
        element: updates,
      });
    },
    [submitOperation]
  );

  // Delete Element Helper
  const deleteElement = useCallback(
    (id: string) => {
      const operationId = `op_del_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      void submitOperation({
        operationId,
        type: 'delete',
        elementId: id,
      });
      if (selectedElementId === id) {
        setSelectedElementId(null);
      }
    },
    [submitOperation, selectedElementId]
  );

  // Undo Handler
  const undo = useCallback(async () => {
    try {
      if (socket?.connected) {
        const ack = await sendSocketWhiteboardUndo(socket, meetingCode);
        if (!ack.ok) return;
      } else {
        await whiteboardApi.undoOperation(meetingCode);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Undo failed.');
    }
  }, [socket, meetingCode]);

  // Redo Handler
  const redo = useCallback(async () => {
    try {
      if (socket?.connected) {
        const ack = await sendSocketWhiteboardRedo(socket, meetingCode);
        if (!ack.ok) return;
      } else {
        await whiteboardApi.redoOperation(meetingCode);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Redo failed.');
    }
  }, [socket, meetingCode]);

  // Clear Board Handler (Host/Co-host)
  const clearBoard = useCallback(async () => {
    try {
      if (socket?.connected) {
        const ack = await sendSocketWhiteboardClear(socket, meetingCode);
        if (!ack.ok) {
          throw new Error(ack.error || 'Failed to clear whiteboard.');
        }
      } else {
        await whiteboardApi.clearWhiteboard(meetingCode);
      }
      setElements(new Map());
      setSelectedElementId(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Clear failed.');
    }
  }, [socket, meetingCode]);

  // Viewport Navigation
  const zoomIn = useCallback(() => {
    setZoom((prev) => Math.min(3, Math.round((prev + 0.25) * 100) / 100));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((prev) => Math.max(0.3, Math.round((prev - 0.25) * 100) / 100));
  }, []);

  const resetViewport = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  return {
    elements,
    version,
    activeTool,
    setActiveTool,
    strokeColor,
    setStrokeColor,
    fillColor,
    setFillColor,
    strokeWidth,
    setStrokeWidth,
    fontSize,
    setFontSize,
    zoom,
    setZoom,
    pan,
    setPan,
    zoomIn,
    zoomOut,
    resetViewport,
    selectedElementId,
    setSelectedElementId,
    remoteCursors,
    isLoading,
    error,
    clearError: () => setError(null),
    addElement,
    updateElement,
    deleteElement,
    undo,
    redo,
    clearBoard,
    broadcastCursor,
    canClearBoard: currentUserRole === 'host' || currentUserRole === 'co-host',
  };
}
