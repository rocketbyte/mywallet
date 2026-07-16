import { Schema, model, Document } from 'mongoose';

export type WatchedSenderKind = 'address' | 'domain';
export type WatchedSenderSource = 'manual' | 'backfill' | 'onboarding';

/**
 * One watched sender for one tenant. Only emails whose sender matches a
 * tenant's watchlist are passed to the AI transaction pipeline — everything
 * else is skipped before any AI call. `value` is stored normalized (lowercase,
 * bare address or bare domain); `kind` is derived from the value at write time.
 */
export interface WatchedSenderInterface extends Document {
  userId: string;
  value: string;
  kind: WatchedSenderKind;
  source: WatchedSenderSource;
  createdAt: Date;
  updatedAt: Date;
}

const WatchedSenderSchema = new Schema<WatchedSenderInterface>({
  userId: { type: String, required: true, index: true },
  value: { type: String, required: true },
  kind: { type: String, enum: ['address', 'domain'], required: true },
  source: { type: String, enum: ['manual', 'backfill', 'onboarding'], required: true },
}, {
  timestamps: true,
  collection: 'watched_senders',
});

// One row per tenant per normalized value — upserts stay race-free.
WatchedSenderSchema.index({ userId: 1, value: 1 }, { unique: true });

export const WatchedSender = model<WatchedSenderInterface>('WatchedSender', WatchedSenderSchema);
