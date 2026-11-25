import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IAuthSession extends Document {
  userId: Types.ObjectId;
  familyId: string;
  refreshTokenHash: string;
  userAgent?: string;
  ipAddress?: string;
  isValid: boolean;
  rotatedAt?: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

const AuthSessionSchema = new Schema<IAuthSession>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    familyId: {
      type: String,
      required: true,
      index: true,
    },
    refreshTokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    userAgent: {
      type: String,
      default: 'Unknown',
    },
    ipAddress: {
      type: String,
      default: 'Unknown',
    },
    isValid: {
      type: Boolean,
      default: true,
    },
    rotatedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: 'auth_sessions',
  }
);

AuthSessionSchema.index({ userId: 1, isValid: 1 });
AuthSessionSchema.index({ familyId: 1, isValid: 1 });
AuthSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuthSession: Model<IAuthSession> =
  mongoose.models.AuthSession || mongoose.model<IAuthSession>('AuthSession', AuthSessionSchema);
