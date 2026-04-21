import { Schema, model, Document } from 'mongoose';

export interface IAlert extends Document {
  userId: string;
  kind?: 'over' | 'large' | 'low' | 'tip';
  title?: string;
  body?: string;
  read: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AlertSchema = new Schema<IAlert>({
  userId: { type: String, index: true },
  kind: { type: String, enum: ['over', 'large', 'low', 'tip'] },
  title: { type: String },
  body: { type: String },
  read: { type: Boolean, default: false },
}, {
  timestamps: true,
  collection: 'alerts',
});

AlertSchema.index({ userId: 1, createdAt: -1 });

export const Alert = model<IAlert>('Alert', AlertSchema);
