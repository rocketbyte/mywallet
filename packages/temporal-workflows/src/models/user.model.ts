import { Schema, model, Document, Types } from 'mongoose';

/**
 * Application user record. The `_id` is the canonical internal user
 * identifier used everywhere in the system. The auth-provider-issued
 * identifier is stored in `authUid` and only consumed by the auth layer
 * for resolution — domain code must never key data on it directly.
 */
export interface UserInterface extends Document {
  _id: Types.ObjectId;
  authUid: string;
  email: string;
  displayName?: string;
  emailVerified?: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<UserInterface>({
  authUid: { type: String, required: true, unique: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  displayName: { type: String },
  emailVerified: { type: Boolean, default: false },
  lastLoginAt: { type: Date },
}, {
  timestamps: true,
  collection: 'users',
});

export const User = model<UserInterface>('User', UserSchema);
