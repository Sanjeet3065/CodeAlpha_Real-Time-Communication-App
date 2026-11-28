import React, { useState } from 'react';
import {
  Pen,
  Highlighter,
  Eraser,
  Square,
  Circle,
  Minus,
  ArrowUpRight,
  Type,
  MousePointer,
  Hand,
  Undo2,
  Redo2,
  Trash2,
  Download,
  ZoomIn,
  ZoomOut,
  ChevronDown,
} from 'lucide-react';
import { ConfirmActionDialog } from './ConfirmActionDialog';
import type { WhiteboardTool } from '@/types/whiteboard';

export interface WhiteboardToolbarProps {
  activeTool: WhiteboardTool;
  onSelectTool: (tool: WhiteboardTool) => void;
  strokeColor: string;
  onSelectStrokeColor: (color: string) => void;
  strokeWidth: number;
  onSelectStrokeWidth: (width: number) => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClearBoard: () => void;
  canClearBoard: boolean;
  onExportPng: () => void;
}

const PRESET_COLORS = [
  { name: 'White', hex: '#FFFFFF' },
  { name: 'Coral Red', hex: '#EF4444' },
  { name: 'Amber', hex: '#F59E0B' },
  { name: 'Mint Green', hex: '#10B981' },
  { name: 'Teal', hex: '#06B6D4' },
  { name: 'Blue', hex: '#3B82F6' },
  { name: 'Purple', hex: '#8B5CF6' },
  { name: 'Chalk', hex: '#EDEFF2' },
];

const STROKE_WIDTHS = [
  { label: 'Thin', value: 2 },
  { label: 'Medium', value: 4 },
  { label: 'Thick', value: 8 },
  { label: 'Heavy', value: 14 },
];

const SHAPE_TOOLS: { tool: WhiteboardTool; label: string; icon: React.FC<{ className?: string }> }[] = [
  { tool: 'rect', label: 'Rectangle', icon: Square },
  { tool: 'circle', label: 'Circle', icon: Circle },
  { tool: 'line', label: 'Line', icon: Minus },
  { tool: 'arrow', label: 'Arrow', icon: ArrowUpRight },
];

export const WhiteboardToolbar: React.FC<WhiteboardToolbarProps> = ({
  activeTool,
  onSelectTool,
  strokeColor,
  onSelectStrokeColor,
  strokeWidth,
  onSelectStrokeWidth,
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onUndo,
  onRedo,
  onClearBoard,
  canClearBoard,
  onExportPng,
}) => {
  const [isShapesOpen, setIsShapesOpen] = useState(false);
  const [isColorsOpen, setIsColorsOpen] = useState(false);
  const [isWidthsOpen, setIsWidthsOpen] = useState(false);
  const [isConfirmClearOpen, setIsConfirmClearOpen] = useState(false);

  const isShapeActive = SHAPE_TOOLS.some((s) => s.tool === activeTool);
  const activeShape = SHAPE_TOOLS.find((s) => s.tool === activeTool) || SHAPE_TOOLS[0];
  const ActiveShapeIcon = activeShape.icon;

  return (
    <>
      <div
        role="toolbar"
        aria-label="Whiteboard tools"
        className="flex flex-wrap items-center justify-center gap-1 sm:gap-1.5 px-3 py-2 bg-[#1C1F24]/90 border border-white/15 rounded-2xl shadow-2xl text-white select-none max-w-full"
      >
        {/* Navigation Tools */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            data-tool="select"
            aria-label="Select and move tool (V)"
            title="Select & Move (V)"
            aria-pressed={activeTool === 'select'}
            onClick={() => onSelectTool('select')}
            className={`p-2 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-[#5FA399] ${
              activeTool === 'select'
                ? 'bg-[#2F6F68] text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <MousePointer className="w-4 h-4" />
          </button>

          <button
            type="button"
            data-tool="pan"
            aria-label="Pan tool (H)"
            title="Pan / Hand tool (H)"
            aria-pressed={activeTool === 'pan'}
            onClick={() => onSelectTool('pan')}
            className={`p-2 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-[#5FA399] ${
              activeTool === 'pan'
                ? 'bg-[#2F6F68] text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <Hand className="w-4 h-4" />
          </button>
        </div>

        <div className="h-5 w-[1px] bg-white/15 mx-0.5" />

        {/* Drawing Tools */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            data-tool="pen"
            aria-label="Pen tool (P)"
            title="Pen (P)"
            aria-pressed={activeTool === 'pen'}
            onClick={() => onSelectTool('pen')}
            className={`p-2 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-[#5FA399] ${
              activeTool === 'pen'
                ? 'bg-[#2F6F68] text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <Pen className="w-4 h-4" />
          </button>

          <button
            type="button"
            data-tool="highlighter"
            aria-label="Highlighter tool"
            title="Highlighter"
            aria-pressed={activeTool === 'highlighter'}
            onClick={() => onSelectTool('highlighter')}
            className={`p-2 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-[#5FA399] ${
              activeTool === 'highlighter'
                ? 'bg-[#2F6F68] text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <Highlighter className="w-4 h-4" />
          </button>

          <button
            type="button"
            data-tool="eraser"
            aria-label="Eraser tool (E)"
            title="Eraser (E)"
            aria-pressed={activeTool === 'eraser'}
            onClick={() => onSelectTool('eraser')}
            className={`p-2 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-[#5FA399] ${
              activeTool === 'eraser'
                ? 'bg-[#2F6F68] text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <Eraser className="w-4 h-4" />
          </button>

          {/* Shapes Dropdown */}
          <div className="relative">
            <button
              type="button"
              data-tool="shapes"
              aria-label="Shape tools"
              title="Shapes (Rectangle, Circle, Line, Arrow)"
              aria-expanded={isShapesOpen}
              aria-pressed={isShapeActive}
              onClick={() => {
                if (isShapeActive) {
                  setIsShapesOpen((prev) => !prev);
                } else {
                  onSelectTool(activeShape.tool);
                  setIsShapesOpen(true);
                }
              }}
              className={`inline-flex items-center gap-0.5 p-2 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-[#5FA399] ${
                isShapeActive
                  ? 'bg-[#2F6F68] text-white shadow-sm'
                  : 'text-slate-300 hover:text-white hover:bg-white/10'
              }`}
            >
              <ActiveShapeIcon className="w-4 h-4" />
              <ChevronDown className="w-3 h-3 opacity-70" />
            </button>

            {isShapesOpen && (
              <div
                role="menu"
                className="absolute bottom-full mb-2 left-0 bg-[#24282E] border border-white/20 rounded-xl p-1.5 shadow-2xl flex flex-col gap-1 z-50 min-w-[130px]"
              >
                {SHAPE_TOOLS.map((shape) => {
                  const Icon = shape.icon;
                  return (
                    <button
                      key={shape.tool}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onSelectTool(shape.tool);
                        setIsShapesOpen(false);
                      }}
                      className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors text-left ${
                        activeTool === shape.tool
                          ? 'bg-[#2F6F68] text-white'
                          : 'text-slate-200 hover:bg-white/10'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{shape.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Text Tool */}
          <button
            type="button"
            data-tool="text"
            aria-label="Text tool (T)"
            title="Text (T)"
            aria-pressed={activeTool === 'text'}
            onClick={() => onSelectTool('text')}
            className={`p-2 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-[#5FA399] ${
              activeTool === 'text'
                ? 'bg-[#2F6F68] text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-white/10'
            }`}
          >
            <Type className="w-4 h-4" />
          </button>
        </div>

        <div className="h-5 w-[1px] bg-white/15 mx-0.5" />

        {/* Color Palette Popover */}
        <div className="relative">
          <button
            type="button"
            data-control="color-picker"
            aria-label="Select stroke color"
            title="Color Palette"
            onClick={() => setIsColorsOpen((prev) => !prev)}
            className="p-1.5 rounded-xl hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-[#5FA399] flex items-center gap-1"
          >
            <span
              className="w-5 h-5 rounded-full border-2 border-white/40 shadow-inner block"
              style={{ backgroundColor: strokeColor }}
            />
            <ChevronDown className="w-3 h-3 text-slate-300" />
          </button>

          {isColorsOpen && (
            <div
              role="dialog"
              aria-label="Color palette"
              className="absolute bottom-full mb-2 left-0 bg-[#24282E] border border-white/20 rounded-xl p-2 shadow-2xl z-50 grid grid-cols-4 gap-2 w-36"
            >
              {PRESET_COLORS.map((col) => (
                <button
                  key={col.hex}
                  type="button"
                  aria-label={col.name}
                  title={col.name}
                  onClick={() => {
                    onSelectStrokeColor(col.hex);
                    setIsColorsOpen(false);
                  }}
                  className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 focus:outline-none ${
                    strokeColor.toUpperCase() === col.hex.toUpperCase()
                      ? 'border-white scale-110 ring-2 ring-[#2F6F68]'
                      : 'border-white/20'
                  }`}
                  style={{ backgroundColor: col.hex }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Stroke Width Selector */}
        <div className="relative">
          <button
            type="button"
            data-control="stroke-width"
            aria-label="Select stroke width"
            title="Stroke Width"
            onClick={() => setIsWidthsOpen((prev) => !prev)}
            className="p-1.5 rounded-xl hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-[#5FA399] flex items-center gap-1"
          >
            <div className="w-5 h-5 flex items-center justify-center">
              <span
                className="w-4 rounded-full bg-white block"
                style={{ height: `${Math.min(strokeWidth, 8)}px` }}
              />
            </div>
            <ChevronDown className="w-3 h-3 text-slate-300" />
          </button>

          {isWidthsOpen && (
            <div
              role="menu"
              className="absolute bottom-full mb-2 left-0 bg-[#24282E] border border-white/20 rounded-xl p-1.5 shadow-2xl flex flex-col gap-1 z-50 min-w-[100px]"
            >
              {STROKE_WIDTHS.map((w) => (
                <button
                  key={w.value}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onSelectStrokeWidth(w.value);
                    setIsWidthsOpen(false);
                  }}
                  className={`inline-flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    strokeWidth === w.value
                      ? 'bg-[#2F6F68] text-white'
                      : 'text-slate-200 hover:bg-white/10'
                  }`}
                >
                  <span>{w.label}</span>
                  <span
                    className="w-4 rounded-full bg-white block ml-2"
                    style={{ height: `${w.value}px` }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="h-5 w-[1px] bg-white/15 mx-0.5" />

        {/* Undo / Redo */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            data-action="undo"
            aria-label="Undo last change (Ctrl+Z)"
            title="Undo (Ctrl+Z)"
            onClick={onUndo}
            className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-[#5FA399]"
          >
            <Undo2 className="w-4 h-4" />
          </button>

          <button
            type="button"
            data-action="redo"
            aria-label="Redo last change (Ctrl+Y)"
            title="Redo (Ctrl+Y)"
            onClick={onRedo}
            className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-[#5FA399]"
          >
            <Redo2 className="w-4 h-4" />
          </button>
        </div>

        <div className="h-5 w-[1px] bg-white/15 mx-0.5" />

        {/* Zoom Controls */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            data-action="zoom-out"
            aria-label="Zoom out"
            title="Zoom Out"
            onClick={onZoomOut}
            className="p-1.5 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-[#5FA399]"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            data-action="reset-zoom"
            aria-label={`Current zoom: ${Math.round(zoom * 100)}%. Click to reset`}
            title="Reset Zoom to 100%"
            onClick={onResetZoom}
            className="px-1.5 py-1 text-[11px] font-mono text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            {Math.round(zoom * 100)}%
          </button>

          <button
            type="button"
            data-action="zoom-in"
            aria-label="Zoom in"
            title="Zoom In"
            onClick={onZoomIn}
            className="p-1.5 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-[#5FA399]"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="h-5 w-[1px] bg-white/15 mx-0.5" />

        {/* Export & Clear Actions */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            data-action="export-png"
            aria-label="Export whiteboard as PNG"
            title="Export as PNG image"
            onClick={onExportPng}
            className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-[#5FA399]"
          >
            <Download className="w-4 h-4" />
          </button>

          {canClearBoard && (
            <button
              type="button"
              data-action="clear-board"
              aria-label="Clear entire whiteboard"
              title="Clear Whiteboard (Host only)"
              onClick={() => setIsConfirmClearOpen(true)}
              className="p-2 rounded-xl text-rose-400 hover:text-rose-200 hover:bg-rose-500/20 transition-colors focus:outline-none focus:ring-2 focus:ring-rose-500"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Clear Board Confirmation Dialog */}
      <ConfirmActionDialog
        isOpen={isConfirmClearOpen}
        title="Clear Whiteboard?"
        description="Are you sure you want to clear the entire whiteboard? All current drawings, shapes, and notes will be removed for everyone in this meeting."
        confirmLabel="Clear Board"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => {
          setIsConfirmClearOpen(false);
          onClearBoard();
        }}
        onCancel={() => setIsConfirmClearOpen(false)}
      />
    </>
  );
};
