import { Schema, model, Document, Types } from 'mongoose';

/**
 * A single identity issued by an external identity provider (Firebase,
 * Google, Apple, an enterprise OIDC issuer, etc). The `subject` is the
 * provider's stable user id (the `sub` claim in OIDC). One application
 * user may eventually accumulate several identities — one per linked IDP.
 */
export interface UserIdentity {
  provider: string;
  subject: string;
  linkedAt?: Date;
}

/**
 * Application user record. The `_id` is the canonical internal user
 * identifier used everywhere in the system. External IDP identities are
 * stored in `identities[]`; domain code must never key data on those
 * directly. `authUid` is preserved as a denormalized pointer to the
 * primary identity's subject — kept unique to act as a fast-lookup index
 * and to remain compatible with documents that predate `identities`.
 */
export interface UserInterface extends Document {
  _id: Types.ObjectId;
  authUid: string;
  identities: UserIdentity[];
  email: string;
  displayName?: string;
  emailVerified?: boolean;
  /**
   * Preferred UI language as a BCP-47 language code (currently 'en' | 'es').
   * Absent means the user has never chosen one — clients fall back to the
   * device locale, then English. Stored per-account so the choice follows
   * the user across devices.
   */
  language?: string;
  /**
   * Preferred UI color theme ('light' | 'dark'). Absent means the user has
   * never chosen one — clients render light (the dark switch defaults off).
   * Stored per-account so the choice follows the user across devices.
   */
  theme?: string;
  lastLoginAt?: Date;
  tenantId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const UserIdentitySchema = new Schema<UserIdentity>({
  provider: { type: String, required: true },
  subject: { type: String, required: true },
  linkedAt: { type: Date, default: Date.now },
}, { _id: false });

const UserSchema = new Schema<UserInterface>({
  authUid: { type: String, required: true, unique: true, index: true },
  identities: { type: [UserIdentitySchema], default: [] },
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  displayName: { type: String },
  emailVerified: { type: Boolean, default: false },
  language: { type: String, enum: ['en', 'es'] },
  theme: { type: String, enum: ['light', 'dark'] },
  lastLoginAt: { type: Date },
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', index: true },
}, {
  timestamps: true,
  collection: 'users',
});

// Cross-document uniqueness: the same (provider, subject) pair can never
// belong to two different users. Partial filter skips users with no
// identities yet (legacy rows or in-flight migrations).
UserSchema.index(
  { 'identities.provider': 1, 'identities.subject': 1 },
  { unique: true, partialFilterExpression: { 'identities.0': { $exists: true } } }
);

export const User = model<UserInterface>('User', UserSchema);
