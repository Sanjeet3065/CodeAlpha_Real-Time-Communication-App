import { useState, useEffect, useRef, useCallback } from 'react';
import { X, PenTool, Eraser, Minus, Square, Circle, ArrowRight, Type, Trash2, Undo2, Redo2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { getWhiteboard, createWhiteboard } from '@/services/meetingApi';
import type { WhiteboardTool, WhiteboardStroke } from '@/types';

interface WhiteboardPanelProps {
  meetingId: string;
  canEdit: boolean;
  onClose: () => void;
}

const COLORS = ['#1e40af', '#059669', '#dc2626', '#d97706', '#7c3aed', '#0891b2', '#000000', '#ffffff'];

export function WhiteboardPanel({ meetingId, canEdit, onClose }: WhiteboardPanelProps) {
  const profile = useAuthStore((s) => s.profile);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<WhiteboardTool>('pen');
  const [color, setColor] = useState('#1e40af');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [isDrawing, setIsDrawing] = useState(false);
  const [strokes, setStrokes] = useState<WhiteboardStroke[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [redoStack, setRedoStack] = useState<WhiteboardStroke[]>([]);
  const currentStrokeRef = useRef<WhiteboardStroke | null>(null);
  const whiteboardIdRef = useRef<string | null>(null);
  const channelRef = useRef<any>(null);

  const getCtx = () => canvasRef.current?.getContext('2d');

  const drawStroke = useCallback((stroke: WhiteboardStroke) => {
    const ctx = getCtx();
    if (!ctx) return;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (stroke.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = stroke.width * 3;
    } else {
      ctx.globalCompositeOperation = 'source-over';
    }

    if (stroke.points.length < 2) {
      ctx.beginPath();
      ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.width / 2, 0, Math.PI * 2);
      ctx.fillStyle = stroke.color;
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      return;
    }

    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

    if (stroke.tool === 'line' || stroke.tool === 'arrow') {
      const last = stroke.points[stroke.points.length - 1];
      ctx.lineTo(last.x, last.y);
      if (stroke.tool === 'arrow') {
        const first = stroke.points[0];
        const angle = Math.atan2(last.y - first.y, last.x - first.x);
        const arrowSize = 15;
        ctx.lineTo(last.x - arrowSize * Math.cos(angle - Math.PI / 6), last.y - arrowSize * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(last.x - arrowSize * Math.cos(angle + Math.PI / 6), last.y - arrowSize * Math.sin(angle + Math.PI / 6));
      }
      ctx.stroke();
    } else if (stroke.tool === 'rectangle') {
      const first = stroke.points[0];
      const last = stroke.points[stroke.points.length - 1];
      ctx.strokeRect(first.x, first.y, last.x - first.x, last.y - first.y);
    } else if (stroke.tool === 'circle') {
      const first = stroke.points[0];
      const last = stroke.points[stroke.points.length - 1];
      const radius = Math.hypot(last.x - first.x, last.y - first.y);
      ctx.beginPath();
      ctx.arc(first.x, first.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    } else if (stroke.tool === 'text') {
      ctx.fillStyle = stroke.color;
      ctx.font = `${stroke.width * 5}px sans-serif`;
      const textPoint = stroke.points[0] as { x: number; y: number; text?: string };
      ctx.fillText(textPoint.text || '', stroke.points[0].x, stroke.points[0].y);
    } else {
      // pen / eraser
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }, []);

  const redrawAll = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokes.forEach(drawStroke);
  }, [strokes, drawStroke]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      redrawAll();
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [redrawAll]);

  useEffect(() => {
    redrawAll();
  }, [strokes, redrawAll]);

  useEffect(() => {
    async function initWhiteboard() {
      let wb = await getWhiteboard(meetingId);
      if (!wb) {
        wb = await createWhiteboard(meetingId);
      }
      whiteboardIdRef.current = wb.id;
      if (wb.snapshot) {
        setStrokes(wb.snapshot as WhiteboardStroke[]);
      }
    }
    initWhiteboard();

    const channelName = `whiteboard:${meetingId}`;
    const existingChannel = supabase.getChannels().find((ch: any) => ch.topic === channelName);
    if (existingChannel) {
      supabase.removeChannel(existingChannel);
    }

    const channel = supabase.channel(channelName);
    channelRef.current = channel;

    channel
      .on('broadcast', { event: 'draw' }, (payload) => {
        if (payload.payload?.userId !== profile?.id) {
          setStrokes((prev) => [...prev, payload.payload.stroke]);
        }
      })
      .on('broadcast', { event: 'clear' }, (payload) => {
        if (payload.payload?.userId !== profile?.id) {
          setStrokes([]);
        }
      })
      .on('broadcast', { event: 'undo' }, (payload) => {
        if (payload.payload?.userId !== profile?.id) {
          setStrokes((prev) => prev.slice(0, -1));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [meetingId, profile?.id]);

  function getPos(e: React.MouseEvent | React.TouchEvent) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    if (!canEdit) return;
    e.preventDefault();
    const pos = getPos(e);
    const stroke: WhiteboardStroke = {
      id: Math.random().toString(36).slice(2),
      tool,
      color,
      width: strokeWidth,
      points: [pos],
    };
    currentStrokeRef.current = stroke;
    setIsDrawing(true);
    setRedoStack([]);
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    if (!isDrawing || !currentStrokeRef.current) return;
    e.preventDefault();
    const pos = getPos(e);
    const stroke = currentStrokeRef.current;

    if (stroke.tool === 'pen' || stroke.tool === 'eraser') {
      stroke.points.push(pos);
    } else {
      stroke.points = [stroke.points[0], pos];
    }

    // Live redraw
    const ctx = getCtx();
    if (ctx && canvasRef.current) {
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      strokes.forEach(drawStroke);
      drawStroke(stroke);
    }
  }

  function endDraw() {
    if (!isDrawing || !currentStrokeRef.current) return;
    const stroke = currentStrokeRef.current;
    setIsDrawing(false);
    currentStrokeRef.current = null;
    setStrokes((prev) => [...prev, stroke]);

    // Broadcast
    channelRef.current?.send({
      type: 'broadcast',
      event: 'draw',
      payload: { userId: profile?.id, stroke },
    });
  }

  function handleUndo() {
    if (!canEdit) return;
    setStrokes((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setRedoStack((r) => [...r, last]);
      channelRef.current?.send({ type: 'broadcast', event: 'undo', payload: { userId: profile?.id } });
      return prev.slice(0, -1);
    });
  }

  function handleRedo() {
    if (!canEdit) return;
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setStrokes((s) => [...s, last]);
      channelRef.current?.send({ type: 'broadcast', event: 'draw', payload: { userId: profile?.id, stroke: last } });
      return prev.slice(0, -1);
    });
  }

  function handleClear() {
    if (!canEdit) return;
    setStrokes([]);
    setRedoStack([]);
    channelRef.current?.send({ type: 'broadcast', event: 'clear', payload: { userId: profile?.id } });
  }

  const tools = [
    { tool: 'pen' as WhiteboardTool, icon: PenTool, label: 'Pen' },
    { tool: 'eraser' as WhiteboardTool, icon: Eraser, label: 'Eraser' },
    { tool: 'line' as WhiteboardTool, icon: Minus, label: 'Line' },
    { tool: 'rectangle' as WhiteboardTool, icon: Square, label: 'Rectangle' },
    { tool: 'circle' as WhiteboardTool, icon: Circle, label: 'Circle' },
    { tool: 'arrow' as WhiteboardTool, icon: ArrowRight, label: 'Arrow' },
    { tool: 'text' as WhiteboardTool, icon: Type, label: 'Text' },
  ];

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <PenTool className="w-5 h-5" /> Whiteboard
        </h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Toolbar */}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-gray-200 dark:border-gray-800">
          {tools.map((t) => (
            <button
              key={t.tool}
              onClick={() => setTool(t.tool)}
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition ${
                tool === t.tool
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
              title={t.label}
            >
              <t.icon className="w-4 h-4" />
            </button>
          ))}
          <div className="w-px h-6 bg-gray-300 dark:bg-gray-700" />
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-7 h-7 rounded-full border-2 transition ${color === c ? 'border-blue-500 scale-110' : 'border-gray-300 dark:border-gray-700'}`}
              style={{ backgroundColor: c }}
            />
          ))}
          <div className="w-px h-6 bg-gray-300 dark:bg-gray-700" />
          <input
            type="range"
            min={1}
            max={20}
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
            className="w-20"
          />
          <div className="w-px h-6 bg-gray-300 dark:bg-gray-700" />
          <button onClick={handleUndo} className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center justify-center transition" title="Undo">
            <Undo2 className="w-4 h-4" />
          </button>
          <button onClick={handleRedo} className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center justify-center transition" title="Redo">
            <Redo2 className="w-4 h-4" />
          </button>
          <button onClick={handleClear} className="w-9 h-9 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-950/50 flex items-center justify-center transition" title="Clear">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Canvas */}
      <div className="flex-1 relative bg-white">
        <canvas
          ref={canvasRef}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
          className={`w-full h-full ${canEdit ? 'cursor-crosshair' : 'cursor-default'}`}
        />
        {!canEdit && (
          <div className="absolute top-2 right-2 px-3 py-1.5 bg-gray-900/80 text-white text-xs rounded-lg">
            View only
          </div>
        )}
      </div>
    </div>
  );
}
