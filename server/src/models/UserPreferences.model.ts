import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IPreferenceFieldTimestamps {
  defaultAudioMuted: number;
  defaultVideoOff: number;
}

export interface IPreferenceFieldVersions {
  defaultAudioMuted: number;
  defaultVideoOff: number;
}

export interface IPreferenceFieldMetaEntry {
  clientSessionId: string;
  serverUpdatedAt: Date;
  lastWriteId: string;
}

export interface IPreferenceFieldMeta {
  defaultAudioMuted: IPreferenceFieldMetaEntry;
  defaultVideoOff: IPreferenceFieldMetaEntry;
}

export interface IUserPreferencesDoc extends Document {
  userId: Types.ObjectId;
  defaultAudioMuted: boolean;
  defaultVideoOff: boolean;
  version: number;
  fieldVersions: IPreferenceFieldVersions;
  fieldTimestamps: IPreferenceFieldTimestamps;
  fieldMeta: IPreferenceFieldMeta;
  createdAt: Date;
  updatedAt: Date;
}

const FieldVersionsSchema = new Schema<IPreferenceFieldVersions>(
  {
    defaultAudioMuted: { type: Number, required: true, default: 0 },
    defaultVideoOff: { type: Number, required: true, default: 0 },
  },
  { _id: false }
);

const FieldTimestampsSchema = new Schema<IPreferenceFieldTimestamps>(
  {
    defaultAudioMuted: { type: Number, required: true, default: 0 },
    defaultVideoOff: { type: Number, required: true, default: 0 },
  },
  { _id: false }
);

const FieldMetaEntrySchema = new Schema<IPreferenceFieldMetaEntry>(
  {
    clientSessionId: { type: String, required: true, default: '' },
    serverUpdatedAt: { type: Date, required: true, default: () => new Date(0) },
    lastWriteId: { type: String, required: true, default: '' },
  },
  { _id: false }
);

const FieldMetaSchema = new Schema<IPreferenceFieldMeta>(
  {
    defaultAudioMuted: {
      type: FieldMetaEntrySchema,
      default: () => ({
        clientSessionId: '',
        serverUpdatedAt: new Date(0),
        lastWriteId: '',
      }),
    },
    defaultVideoOff: {
      type: FieldMetaEntrySchema,
      default: () => ({
        clientSessionId: '',
        serverUpdatedAt: new Date(0),
        lastWriteId: '',
      }),
    },
  },
  { _id: false }
);

const UserPreferencesSchema = new Schema<IUserPreferencesDoc>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    defaultAudioMuted: {
      type: Boolean,
      required: true,
      default: true,
    },
    defaultVideoOff: {
      type: Boolean,
      required: true,
      default: false,
    },
    version: {
      type: Number,
      required: true,
      default: 1,
    },
    fieldVersions: {
      type: FieldVersionsSchema,
      default: () => ({
        defaultAudioMuted: 0,
        defaultVideoOff: 0,
      }),
    },
    fieldTimestamps: {
      type: FieldTimestampsSchema,
      default: () => ({
        defaultAudioMuted: 0,
        defaultVideoOff: 0,
      }),
    },
    fieldMeta: {
      type: FieldMetaSchema,
      default: () => ({
        defaultAudioMuted: {
          clientSessionId: '',
          serverUpdatedAt: new Date(0),
          lastWriteId: '',
        },
        defaultVideoOff: {
          clientSessionId: '',
          serverUpdatedAt: new Date(0),
          lastWriteId: '',
        },
      }),
    },
  },
  {
    collection: 'user_preferences',
    timestamps: true,
  }
);

export const UserPreferences: Model<IUserPreferencesDoc> =
  mongoose.models.UserPreferences ||
  mongoose.model<IUserPreferencesDoc>('UserPreferences', UserPreferencesSchema);
