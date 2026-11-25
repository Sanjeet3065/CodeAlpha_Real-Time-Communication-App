import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type WhiteboardElementType =
  | 'pen'
  | 'highlighter'
  | 'rect'
  | 'circle'
  | 'line'
  | 'arrow'
  | 'text';

export interface IWhiteboardPoint {
  x: number;
  y: number;
}

export interface IWhiteboardElement {
  id: string; // Unique element UUID
  type: WhiteboardElementType;
  points?: IWhiteboardPoint[];
  x: number;
  y: number;
  width?: number;
  height?: number;
  x2?: number; // End X for line/arrow
  y2?: number; // End Y for line/arrow
  text?: string;
  fontSize?: number;
  strokeColor: string;
  fillColor?: string;
  strokeWidth: number;
  opacity?: number;
  zIndex: number;
  createdBy: Types.ObjectId;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
  isDeleted: boolean;
}

export interface IWhiteboard extends Document {
  meetingId: Types.ObjectId;
  version: number; // Monotonically increasing board state sequence
  elements: Map<string, IWhiteboardElement>;
  appliedOperationIds: string[]; // Bounded ring buffer of recently applied operation UUIDs
  lastModifiedBy?: Types.ObjectId | null;
  lastModifiedByName?: string | null;
  lastClearedAt?: Date | null;
  lastClearedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WhiteboardElementDto {
  id: string;
  type: WhiteboardElementType;
  points?: IWhiteboardPoint[];
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

export interface WhiteboardStateDto {
  meetingId: string;
  version: number;
  elements: WhiteboardElementDto[];
  lastModifiedBy?: string | null;
  lastModifiedByName?: string | null;
  lastClearedAt?: string | null;
  elementCount: number;
  updatedAt: string;
}

const WhiteboardPointSchema = new Schema<IWhiteboardPoint>(
  {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
  },
  { _id: false }
);

const WhiteboardElementSchema = new Schema<IWhiteboardElement>(
  {
    id: { type: String, required: true },
    type: {
      type: String,
      enum: ['pen', 'highlighter', 'rect', 'circle', 'line', 'arrow', 'text'],
      required: true,
    },
    points: { type: [WhiteboardPointSchema], default: undefined },
    x: { type: Number, required: true, default: 0 },
    y: { type: Number, required: true, default: 0 },
    width: { type: Number, default: undefined },
    height: { type: Number, default: undefined },
    x2: { type: Number, default: undefined },
    y2: { type: Number, default: undefined },
    text: { type: String, maxlength: 1000, default: undefined },
    fontSize: { type: Number, min: 8, max: 128, default: 16 },
    strokeColor: { type: String, required: true, default: '#172B3A' },
    fillColor: { type: String, default: undefined },
    strokeWidth: { type: Number, required: true, min: 1, max: 50, default: 3 },
    opacity: { type: Number, min: 0, max: 1, default: 1 },
    zIndex: { type: Number, required: true, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: true, default: 'Participant' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    isDeleted: { type: Boolean, default: false },
  },
  { _id: false }
);

const WhiteboardSchema = new Schema<IWhiteboard>(
  {
    meetingId: {
      type: Schema.Types.ObjectId,
      ref: 'Meeting',
      required: true,
      unique: true,
      index: true,
    },
    version: {
      type: Number,
      required: true,
      default: 1,
    },
    elements: {
      type: Map,
      of: WhiteboardElementSchema,
      default: () => new Map(),
    },
    appliedOperationIds: {
      type: [String],
      default: () => [],
      index: true,
    },
    lastModifiedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    lastModifiedByName: {
      type: String,
      default: null,
    },
    lastClearedAt: {
      type: Date,
      default: null,
    },
    lastClearedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export function toWhiteboardElementDto(el: IWhiteboardElement): WhiteboardElementDto {
  return {
    id: el.id,
    type: el.type,
    points: el.points ? el.points.map((p) => ({ x: p.x, y: p.y })) : undefined,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    x2: el.x2,
    y2: el.y2,
    text: el.text,
    fontSize: el.fontSize,
    strokeColor: el.strokeColor,
    fillColor: el.fillColor,
    strokeWidth: el.strokeWidth,
    opacity: el.opacity,
    zIndex: el.zIndex,
    createdBy: el.createdBy.toString(),
    createdByName: el.createdByName,
    createdAt: el.createdAt instanceof Date ? el.createdAt.toISOString() : new Date(el.createdAt).toISOString(),
    updatedAt: el.updatedAt instanceof Date ? el.updatedAt.toISOString() : new Date(el.updatedAt).toISOString(),
    isDeleted: el.isDeleted,
  };
}

export function toWhiteboardStateDto(board: IWhiteboard): WhiteboardStateDto {
  const activeElements: WhiteboardElementDto[] = [];
  if (board.elements && board.elements instanceof Map) {
    for (const el of board.elements.values()) {
      if (!el.isDeleted) {
        activeElements.push(toWhiteboardElementDto(el));
      }
    }
  } else if (board.elements && typeof board.elements === 'object') {
    for (const key of Object.keys(board.elements)) {
      const el = (board.elements as any)[key];
      if (el && !el.isDeleted) {
        activeElements.push(toWhiteboardElementDto(el));
      }
    }
  }

  // Sort by zIndex ascending for deterministic layer rendering
  activeElements.sort((a, b) => a.zIndex - b.zIndex);

  return {
    meetingId: board.meetingId.toString(),
    version: board.version,
    elements: activeElements,
    lastModifiedBy: board.lastModifiedBy ? board.lastModifiedBy.toString() : null,
    lastModifiedByName: board.lastModifiedByName || null,
    lastClearedAt: board.lastClearedAt ? board.lastClearedAt.toISOString() : null,
    elementCount: activeElements.length,
    updatedAt: board.updatedAt instanceof Date ? board.updatedAt.toISOString() : new Date().toISOString(),
  };
}

export const Whiteboard: Model<IWhiteboard> = mongoose.model<IWhiteboard>(
  'Whiteboard',
  WhiteboardSchema
);
