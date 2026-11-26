import React, { useRef, useEffect, useState, useCallback } from 'react';
import { simplifyFreehandPath } from '@/utils/pathSimplifier';
import type {
  WhiteboardElement,
  WhiteboardTool,
  WhiteboardPoint,
  WhiteboardCursor,
} from '@/types/whiteboard';

interface WhiteboardCanvasProps {
  elements: Map<string, WhiteboardElement>;
  activeTool: WhiteboardTool;
  strokeColor: string;
  fillColor?: string;
  strokeWidth: number;
  fontSize: number;
  zoom: number;
  pan: { x: number; y: number };
  setPan: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  selectedElementId: string | null;
  onSelectElement: (id: string | null) => void;
  onAddElement: (element: WhiteboardElement) => void;
  onUpdateElement: (id: string, updates: Partial<WhiteboardElement>) => void;
  onDeleteElement: (id: string) => void;
  onBroadcastCursor: (x: number, y: number) => void;
  remoteCursors: Map<string, WhiteboardCursor>;
  currentUserId: string;
  currentUserName: string;
  canvasRef?: React.RefObject<HTMLCanvasElement>;
}

export const WhiteboardCanvas: React.FC<WhiteboardCanvasProps> = ({
  elements,
  activeTool,
  strokeColor,
  fillColor,
  strokeWidth,
  fontSize,
  zoom,
  pan,
  setPan,
  selectedElementId,
  onSelectElement,
  onAddElement,
  onUpdateElement,
  onDeleteElement,
  onBroadcastCursor,
  remoteCursors,
  currentUserId,
  currentUserName,
  canvasRef: externalCanvasRef,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const internalCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = externalCanvasRef || internalCanvasRef;

  // Drawing state
  const isInteractingRef = useRef<boolean>(false);
  const startPointRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const currentPointsRef = useRef<WhiteboardPoint[]>([]);
  const isPanningRef = useRef<boolean>(false);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Moving selected element
  const isDraggingElementRef = useRef<boolean>(false);
  const dragStartElementPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // In-place text input overlay
  const [textInput, setTextInput] = useState<{
    visible: boolean;
    x: number;
    y: number;
    canvasX: number;
    canvasY: number;
    text: string;
  }>({
    visible: false,
    x: 0,
    y: 0,
    canvasX: 0,
    canvasY: 0,
    text: '',
  });

  const textInputRef = useRef<HTMLTextAreaElement>(null);

  // Convert screen coordinates to canvas coordinate space
  const screenToCanvas = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      if (!canvasRef.current) return { x: 0, y: 0 };
      const rect = canvasRef.current.getBoundingClientRect();
      const screenX = clientX - rect.left;
      const screenY = clientY - rect.top;
      return {
        x: (screenX - pan.x) / zoom,
        y: (screenY - pan.y) / zoom,
      };
    },
    [canvasRef, pan, zoom]
  );

  // Hit-testing helper to find element under cursor
  const hitTestElement = useCallback(
    (canvasX: number, canvasY: number): WhiteboardElement | null => {
      const sorted = Array.from(elements.values())
        .filter((el) => !el.isDeleted)
        .sort((a, b) => b.zIndex - a.zIndex); // Test topmost first

      for (const el of sorted) {
        if (el.type === 'pen' || el.type === 'highlighter') {
          if (!el.points || el.points.length === 0) continue;
          const threshold = Math.max(10, el.strokeWidth * 1.5);
          for (const pt of el.points) {
            const dist = Math.hypot(pt.x - canvasX, pt.y - canvasY);
            if (dist <= threshold) return el;
          }
        } else if (el.type === 'rect') {
          const w = el.width || 0;
          const h = el.height || 0;
          const minX = Math.min(el.x, el.x + w);
          const maxX = Math.max(el.x, el.x + w);
          const minY = Math.min(el.y, el.y + h);
          const maxY = Math.max(el.y, el.y + h);
          if (canvasX >= minX - 8 && canvasX <= maxX + 8 && canvasY >= minY - 8 && canvasY <= maxY + 8) {
            return el;
          }
        } else if (el.type === 'circle') {
          const w = Math.abs(el.width || 0);
          const h = Math.abs(el.height || 0);
          const cx = el.x + (el.width || 0) / 2;
          const cy = el.y + (el.height || 0) / 2;
          const rx = Math.max(w / 2, 8);
          const ry = Math.max(h / 2, 8);
          const normalizedDist = Math.pow((canvasX - cx) / rx, 2) + Math.pow((canvasY - cy) / ry, 2);
          if (normalizedDist <= 1.2) return el;
        } else if (el.type === 'line' || el.type === 'arrow') {
          const x2 = el.x2 ?? el.x;
          const y2 = el.y2 ?? el.y;
          // Distance from point to line segment
          const l2 = Math.hypot(x2 - el.x, y2 - el.y);
          if (l2 === 0) {
            if (Math.hypot(canvasX - el.x, canvasY - el.y) < 10) return el;
            continue;
          }
          const t = Math.max(0, Math.min(1, ((canvasX - el.x) * (x2 - el.x) + (canvasY - el.y) * (y2 - el.y)) / (l2 * l2)));
          const projX = el.x + t * (x2 - el.x);
          const projY = el.y + t * (y2 - el.y);
          if (Math.hypot(canvasX - projX, canvasY - projY) < Math.max(8, el.strokeWidth * 1.5)) {
            return el;
          }
        } else if (el.type === 'text') {
          const textW = (el.text?.length || 1) * (el.fontSize || 16) * 0.6;
          const textH = (el.fontSize || 16) * 1.2;
          if (canvasX >= el.x - 4 && canvasX <= el.x + textW + 4 && canvasY >= el.y - textH && canvasY <= el.y + 8) {
            return el;
          }
        }
      }
      return null;
    },
    [elements]
  );

  // Main Canvas Render Function
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // Clear background (#111316)
    ctx.fillStyle = '#111316';
    ctx.fillRect(0, 0, rect.width, rect.height);

    // Apply viewport Pan and Zoom
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Render subtle dot grid
    const dotSpacing = 32;
    const startX = Math.floor((-pan.x / zoom) / dotSpacing) * dotSpacing;
    const endX = Math.ceil(((rect.width - pan.x) / zoom) / dotSpacing) * dotSpacing;
    const startY = Math.floor((-pan.y / zoom) / dotSpacing) * dotSpacing;
    const endY = Math.ceil(((rect.height - pan.y) / zoom) / dotSpacing) * dotSpacing;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    for (let x = startX; x <= endX; x += dotSpacing) {
      for (let y = startY; y <= endY; y += dotSpacing) {
        ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
      }
    }

    // Sort elements by zIndex ascending for correct layering
    const sortedElements = Array.from(elements.values())
      .filter((el) => !el.isDeleted)
      .sort((a, b) => a.zIndex - b.zIndex);

    // Render active elements
    for (const el of sortedElements) {
      ctx.save();
      ctx.globalAlpha = el.opacity ?? 1;
      ctx.strokeStyle = el.strokeColor;
      ctx.lineWidth = el.strokeWidth;
      ctx.lineCap = el.type === 'highlighter' ? 'square' : 'round';
      ctx.lineJoin = 'round';

      if (el.type === 'highlighter') {
        ctx.globalAlpha = 0.35;
      }

      if (el.type === 'pen' || el.type === 'highlighter') {
        if (el.points && el.points.length > 0) {
          ctx.beginPath();
          ctx.moveTo(el.points[0].x, el.points[0].y);
          if (el.points.length === 1) {
            ctx.arc(el.points[0].x, el.points[0].y, el.strokeWidth / 2, 0, Math.PI * 2);
            ctx.fillStyle = el.strokeColor;
            ctx.fill();
          } else {
            for (let i = 1; i < el.points.length; i += 1) {
              const prev = el.points[i - 1];
              const cur = el.points[i];
              const midX = (prev.x + cur.x) / 2;
              const midY = (prev.y + cur.y) / 2;
              ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
            }
            const last = el.points[el.points.length - 1];
            ctx.lineTo(last.x, last.y);
            ctx.stroke();
          }
        }
      } else if (el.type === 'rect') {
        const w = el.width || 0;
        const h = el.height || 0;
        if (el.fillColor) {
          ctx.fillStyle = el.fillColor;
          ctx.fillRect(el.x, el.y, w, h);
        }
        ctx.strokeRect(el.x, el.y, w, h);
      } else if (el.type === 'circle') {
        const w = Math.abs(el.width || 0);
        const h = Math.abs(el.height || 0);
        const cx = el.x + (el.width || 0) / 2;
        const cy = el.y + (el.height || 0) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(w / 2, 0.1), Math.max(h / 2, 0.1), 0, 0, Math.PI * 2);
        if (el.fillColor) {
          ctx.fillStyle = el.fillColor;
          ctx.fill();
        }
        ctx.stroke();
      } else if (el.type === 'line') {
        const x2 = el.x2 ?? el.x;
        const y2 = el.y2 ?? el.y;
        ctx.beginPath();
        ctx.moveTo(el.x, el.y);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      } else if (el.type === 'arrow') {
        const x2 = el.x2 ?? el.x;
        const y2 = el.y2 ?? el.y;
        const headLength = Math.max(12, el.strokeWidth * 3);
        const angle = Math.atan2(y2 - el.y, x2 - el.x);

        ctx.beginPath();
        ctx.moveTo(el.x, el.y);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // Arrowhead
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(
          x2 - headLength * Math.cos(angle - Math.PI / 6),
          y2 - headLength * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
          x2 - headLength * Math.cos(angle + Math.PI / 6),
          y2 - headLength * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fillStyle = el.strokeColor;
        ctx.fill();
      } else if (el.type === 'text') {
        if (el.text) {
          ctx.font = `${el.fontSize || 18}px Inter, -apple-system, sans-serif`;
          ctx.fillStyle = el.strokeColor;
          ctx.textBaseline = 'bottom';
          const lines = el.text.split('\n');
          const lineHeight = (el.fontSize || 18) * 1.25;
          lines.forEach((line, idx) => {
            ctx.fillText(line, el.x, el.y + idx * lineHeight);
          });
        }
      }

      ctx.restore();
    }

    // Render bounding box around selected element
    if (selectedElementId && elements.has(selectedElementId)) {
      const sel = elements.get(selectedElementId)!;
      if (!sel.isDeleted) {
        ctx.save();
        ctx.strokeStyle = '#2F6F68';
        ctx.lineWidth = 1.5 / zoom;
        ctx.setLineDash([4 / zoom, 4 / zoom]);

        let bounds = { x: sel.x - 6, y: sel.y - 6, w: (sel.width || 0) + 12, h: (sel.height || 0) + 12 };
        if (sel.type === 'line' || sel.type === 'arrow') {
          const x2 = sel.x2 ?? sel.x;
          const y2 = sel.y2 ?? sel.y;
          const minX = Math.min(sel.x, x2) - 6;
          const minY = Math.min(sel.y, y2) - 6;
          const maxX = Math.max(sel.x, x2) + 6;
          const maxY = Math.max(sel.y, y2) + 6;
          bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
        } else if (sel.type === 'text') {
          const textW = (sel.text?.length || 1) * (sel.fontSize || 18) * 0.65;
          const textH = (sel.fontSize || 18) * 1.3;
          bounds = { x: sel.x - 4, y: sel.y - textH - 2, w: textW + 8, h: textH + 8 };
        }

        ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
        ctx.restore();
      }
    }

    // Render In-Progress Local Stroke / Shape Preview
    if (isInteractingRef.current) {
      ctx.save();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = activeTool === 'highlighter' ? 'square' : 'round';
      ctx.lineJoin = 'round';
      if (activeTool === 'highlighter') ctx.globalAlpha = 0.35;

      const pts = currentPointsRef.current;
      if ((activeTool === 'pen' || activeTool === 'highlighter') && pts.length > 0) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i += 1) {
          const prev = pts[i - 1];
          const cur = pts[i];
          ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + cur.x) / 2, (prev.y + cur.y) / 2);
        }
        ctx.stroke();
      } else if (activeTool === 'rect' && pts.length > 0) {
        const start = startPointRef.current;
        const cur = pts[pts.length - 1];
        if (fillColor) {
          ctx.fillStyle = fillColor;
          ctx.fillRect(start.x, start.y, cur.x - start.x, cur.y - start.y);
        }
        ctx.strokeRect(start.x, start.y, cur.x - start.x, cur.y - start.y);
      } else if (activeTool === 'circle' && pts.length > 0) {
        const start = startPointRef.current;
        const cur = pts[pts.length - 1];
        const w = cur.x - start.x;
        const h = cur.y - start.y;
        ctx.beginPath();
        ctx.ellipse(start.x + w / 2, start.y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
        if (fillColor) {
          ctx.fillStyle = fillColor;
          ctx.fill();
        }
        ctx.stroke();
      } else if (activeTool === 'line' && pts.length > 0) {
        const start = startPointRef.current;
        const cur = pts[pts.length - 1];
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(cur.x, cur.y);
        ctx.stroke();
      } else if (activeTool === 'arrow' && pts.length > 0) {
        const start = startPointRef.current;
        const cur = pts[pts.length - 1];
        const angle = Math.atan2(cur.y - start.y, cur.x - start.x);
        const headLength = Math.max(12, strokeWidth * 3);

        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(cur.x, cur.y);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(cur.x, cur.y);
        ctx.lineTo(
          cur.x - headLength * Math.cos(angle - Math.PI / 6),
          cur.y - headLength * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
          cur.x - headLength * Math.cos(angle + Math.PI / 6),
          cur.y - headLength * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fillStyle = strokeColor;
        ctx.fill();
      }
      ctx.restore();
    }

    // Render Remote Cursors
    for (const [uid, cursor] of remoteCursors.entries()) {
      if (uid === currentUserId) continue;

      ctx.save();
      const cursorColor = cursor.color || '#E59A30';

      // Cursor dot
      ctx.fillStyle = cursorColor;
      ctx.beginPath();
      ctx.arc(cursor.x, cursor.y, 4 / zoom, 0, Math.PI * 2);
      ctx.fill();

      // Remote user pill badge
      ctx.font = `${Math.max(10, 11 / zoom)}px Inter, sans-serif`;
      const nameText = cursor.userName || 'Participant';
      const textMetrics = ctx.measureText(nameText);
      const pillWidth = textMetrics.width + 12 / zoom;
      const pillHeight = 18 / zoom;
      const pillX = cursor.x + 8 / zoom;
      const pillY = cursor.y - 10 / zoom;

      ctx.fillStyle = cursorColor;
      ctx.beginPath();
      ctx.roundRect(pillX, pillY, pillWidth, pillHeight, 4 / zoom);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.textBaseline = 'middle';
      ctx.fillText(nameText, pillX + 6 / zoom, pillY + pillHeight / 2);

      ctx.restore();
    }

    ctx.restore();
  }, [
    canvasRef,
    elements,
    zoom,
    pan,
    selectedElementId,
    activeTool,
    strokeColor,
    fillColor,
    strokeWidth,
    remoteCursors,
    currentUserId,
  ]);

  // Request Animation Frame on state changes
  useEffect(() => {
    const animId = requestAnimationFrame(renderCanvas);
    return () => cancelAnimationFrame(animId);
  }, [renderCanvas]);

  // Pointer Down Handler
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const canvasPt = screenToCanvas(e.clientX, e.clientY);

    // Pan tool or Middle Click
    if (activeTool === 'pan' || e.button === 1) {
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      return;
    }

    if (activeTool === 'select') {
      const hit = hitTestElement(canvasPt.x, canvasPt.y);
      if (hit) {
        onSelectElement(hit.id);
        isDraggingElementRef.current = true;
        dragStartElementPosRef.current = { x: hit.x, y: hit.y };
        startPointRef.current = canvasPt;
      } else {
        onSelectElement(null);
      }
      return;
    }

    if (activeTool === 'eraser') {
      const hit = hitTestElement(canvasPt.x, canvasPt.y);
      if (hit) {
        onDeleteElement(hit.id);
      }
      isInteractingRef.current = true;
      return;
    }

    if (activeTool === 'text') {
      // Open inline text input at clicked location
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      setTextInput({
        visible: true,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        canvasX: canvasPt.x,
        canvasY: canvasPt.y,
        text: '',
      });
      setTimeout(() => textInputRef.current?.focus(), 20);
      return;
    }

    // Drawing shapes or pen/highlighter
    isInteractingRef.current = true;
    startPointRef.current = canvasPt;
    currentPointsRef.current = [canvasPt];
  };

  // Pointer Move Handler
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvasPt = screenToCanvas(e.clientX, e.clientY);

    // Broadcast cursor position to remote participants
    onBroadcastCursor(canvasPt.x, canvasPt.y);

    if (isPanningRef.current) {
      setPan({
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      });
      return;
    }

    if (isDraggingElementRef.current && selectedElementId) {
      const dx = canvasPt.x - startPointRef.current.x;
      const dy = canvasPt.y - startPointRef.current.y;
      onUpdateElement(selectedElementId, {
        x: Math.round(dragStartElementPosRef.current.x + dx),
        y: Math.round(dragStartElementPosRef.current.y + dy),
      });
      return;
    }

    if (!isInteractingRef.current) return;

    if (activeTool === 'eraser') {
      const hit = hitTestElement(canvasPt.x, canvasPt.y);
      if (hit) {
        onDeleteElement(hit.id);
      }
      return;
    }

    if (activeTool === 'pen' || activeTool === 'highlighter') {
      const lastPt = currentPointsRef.current[currentPointsRef.current.length - 1];
      if (!lastPt || Math.hypot(canvasPt.x - lastPt.x, canvasPt.y - lastPt.y) >= 1.0) {
        currentPointsRef.current.push(canvasPt);
        renderCanvas();
      }
    } else if (['rect', 'circle', 'line', 'arrow'].includes(activeTool)) {
      currentPointsRef.current = [canvasPt];
      renderCanvas();
    }
  };

  // Pointer Up Handler
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      return;
    }

    if (isDraggingElementRef.current) {
      isDraggingElementRef.current = false;
      return;
    }

    if (!isInteractingRef.current) return;
    isInteractingRef.current = false;

    const canvasPt = screenToCanvas(e.clientX, e.clientY);
    const start = startPointRef.current;
    const elementId = `el_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

    if (activeTool === 'pen' || activeTool === 'highlighter') {
      if (currentPointsRef.current.length > 0) {
        // DEF-17-04: Simplify freehand path using RDP to decimate redundant points by 60-75%
        const optimizedPoints = simplifyFreehandPath(currentPointsRef.current, 1.0, 1.5);
        onAddElement({
          id: elementId,
          type: activeTool,
          points: optimizedPoints,
          x: optimizedPoints[0]?.x ?? currentPointsRef.current[0].x,
          y: optimizedPoints[0]?.y ?? currentPointsRef.current[0].y,
          strokeColor,
          strokeWidth,
          opacity: activeTool === 'highlighter' ? 0.35 : 1,
          zIndex: elements.size + 1,
          createdBy: currentUserId,
          createdByName: currentUserName,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    } else if (activeTool === 'rect') {
      const w = canvasPt.x - start.x;
      const h = canvasPt.y - start.y;
      if (Math.abs(w) > 3 || Math.abs(h) > 3) {
        onAddElement({
          id: elementId,
          type: 'rect',
          x: w < 0 ? canvasPt.x : start.x,
          y: h < 0 ? canvasPt.y : start.y,
          width: Math.abs(w),
          height: Math.abs(h),
          strokeColor,
          fillColor,
          strokeWidth,
          zIndex: elements.size + 1,
          createdBy: currentUserId,
          createdByName: currentUserName,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    } else if (activeTool === 'circle') {
      const w = canvasPt.x - start.x;
      const h = canvasPt.y - start.y;
      if (Math.abs(w) > 3 || Math.abs(h) > 3) {
        onAddElement({
          id: elementId,
          type: 'circle',
          x: w < 0 ? canvasPt.x : start.x,
          y: h < 0 ? canvasPt.y : start.y,
          width: Math.abs(w),
          height: Math.abs(h),
          strokeColor,
          fillColor,
          strokeWidth,
          zIndex: elements.size + 1,
          createdBy: currentUserId,
          createdByName: currentUserName,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    } else if (activeTool === 'line') {
      if (Math.hypot(canvasPt.x - start.x, canvasPt.y - start.y) > 3) {
        onAddElement({
          id: elementId,
          type: 'line',
          x: start.x,
          y: start.y,
          x2: canvasPt.x,
          y2: canvasPt.y,
          strokeColor,
          strokeWidth,
          zIndex: elements.size + 1,
          createdBy: currentUserId,
          createdByName: currentUserName,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    } else if (activeTool === 'arrow') {
      if (Math.hypot(canvasPt.x - start.x, canvasPt.y - start.y) > 3) {
        onAddElement({
          id: elementId,
          type: 'arrow',
          x: start.x,
          y: start.y,
          x2: canvasPt.x,
          y2: canvasPt.y,
          strokeColor,
          strokeWidth,
          zIndex: elements.size + 1,
          createdBy: currentUserId,
          createdByName: currentUserName,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    currentPointsRef.current = [];
  };

  // Wheel Zoom / Pan Handler
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
      // Pinch-zoom
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      setPan((prevPan) => {
        const newZoom = Math.max(0.3, Math.min(3, zoom * zoomFactor));
        return {
          x: mouseX - (mouseX - prevPan.x) * (newZoom / zoom),
          y: mouseY - (mouseY - prevPan.y) * (newZoom / zoom),
        };
      });
    } else {
      // Pan
      setPan((prev) => ({
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      }));
    }
  };

  // Commit text input
  const handleCommitText = () => {
    if (textInput.text.trim()) {
      const elementId = `text_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      onAddElement({
        id: elementId,
        type: 'text',
        x: textInput.canvasX,
        y: textInput.canvasY,
        text: textInput.text.trim(),
        fontSize,
        strokeColor,
        strokeWidth: 1,
        zIndex: elements.size + 1,
        createdBy: currentUserId,
        createdByName: currentUserName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    setTextInput((prev) => ({ ...prev, visible: false, text: '' }));
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden select-none bg-[#111316]"
    >
      <canvas
        ref={canvasRef}
        role="region"
        aria-label="Collaborative Whiteboard Canvas"
        data-whiteboard-canvas="true"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
        className={`w-full h-full touch-none block ${
          activeTool === 'pan'
            ? 'cursor-grab active:cursor-grabbing'
            : activeTool === 'select'
            ? 'cursor-default'
            : activeTool === 'eraser'
            ? 'cursor-crosshair'
            : activeTool === 'text'
            ? 'cursor-text'
            : 'cursor-crosshair'
        }`}
      />

      {/* Floating In-Place Text Input Overlay */}
      {textInput.visible && (
        <div
          style={{
            position: 'absolute',
            left: `${textInput.x}px`,
            top: `${textInput.y - (fontSize || 18)}px`,
            zIndex: 50,
          }}
          className="min-w-[120px]"
        >
          <textarea
            ref={textInputRef}
            value={textInput.text}
            onChange={(e) => setTextInput((prev) => ({ ...prev, text: e.target.value }))}
            onKeyDown={(e) => {
              // Crucial: stop propagation so meeting shortcuts (e.g. M for mic, Space) are not triggered!
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleCommitText();
              } else if (e.key === 'Escape') {
                setTextInput((prev) => ({ ...prev, visible: false, text: '' }));
              }
            }}
            onBlur={handleCommitText}
            placeholder="Type text..."
            style={{
              fontSize: `${(fontSize || 18) * zoom}px`,
              color: strokeColor,
              lineHeight: 1.25,
            }}
            className="bg-[#1C1F24]/90 border border-[#5FA399] text-white rounded p-1 outline-none resize-none shadow-lg"
            rows={Math.max(1, textInput.text.split('\n').length)}
          />
        </div>
      )}
    </div>
  );
};
