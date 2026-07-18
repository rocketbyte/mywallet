import { Schema, model, Document } from 'mongoose';

export interface AlertInterface extends Document {
  userId: string;
  kind?: 'over' | 'large' | 'low' | 'tip';
  title?: string;
  body?: string;
  read: boolean;
  /** Set the first time the alert is marked read; never advanced afterwards. */
  readAt?: Date;
  /**
   * Stable idempotency key for system-generated alerts (e.g.
   * `over:budget:<category>:<year>-<month>`). Absent on manually-created alerts.
   * `(userId, dedupeKey)` is unique where present, so the same underlying
   * condition never produces more than one alert.
   */
  dedupeKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AlertSchema = new Schema<AlertInterface>({
  userId: { type: String, required: true, index: true },
  kind: { type: String, enum: ['over', 'large', 'low', 'tip'] },
  title: { type: String },
  body: { type: String },
  read: { type: Boolean, default: false },
  readAt: { type: Date },
  dedupeKey: { type: String },
}, {
  timestamps: true,
  collection: 'alerts',
});

AlertSchema.index({ userId: 1, createdAt: -1 });
// Exactly-once generation per underlying condition. Partial so manual alerts
// (no dedupeKey) are exempt from the uniqueness constraint.
AlertSchema.index(
  { userId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);

export const Alert = model<AlertInterface>('Alert', AlertSchema);
