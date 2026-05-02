import { Schema, model, Document } from 'mongoose';

export interface PendingTransactionInterface extends Document {
  userId: string;
  merchant?: string;
  amount?: number;
  category?: string;
  confidence?: number;
  source?: string;
  snippet?: string;
  rawEmail?: string;
  emailId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PendingTransactionSchema = new Schema<PendingTransactionInterface>({
  userId: { type: String, required: true, index: true },
  merchant: { type: String },
  amount: { type: Number },
  category: { type: String },
  confidence: { type: Number, min: 0, max: 1 },
  source: { type: String },
  snippet: { type: String },
  rawEmail: { type: String },
  emailId: { type: String },
}, {
  timestamps: true,
  collection: 'pending_transactions',
});

export const PendingTransaction = model<PendingTransactionInterface>('PendingTransaction', PendingTransactionSchema);
