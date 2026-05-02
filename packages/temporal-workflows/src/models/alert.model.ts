import { Schema, model, Document } from 'mongoose';

export interface AlertInterface extends Document {
  userId: string;
  kind?: 'over' | 'large' | 'low' | 'tip';
  title?: string;
  body?: string;
  read: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AlertSchema = new Schema<AlertInterface>({
  userId: { type: String, required: true, index: true },
  kind: { type: String, enum: ['over', 'large', 'low', 'tip'] },
  title: { type: String },
  body: { type: String },
  read: { type: Boolean, default: false },
}, {
  timestamps: true,
  collection: 'alerts',
});

AlertSchema.index({ userId: 1, createdAt: -1 });

export const Alert = model<AlertInterface>('Alert', AlertSchema);
