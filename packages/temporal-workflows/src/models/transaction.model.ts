import { Schema, model, Document } from 'mongoose';

export interface ITransaction extends Document {
  userId: string;

  // Source (optional for manual transactions)
  emailId?: string;
  emailSubject?: string;
  emailDate?: Date;
  emailFrom?: string;

  // Transaction Details
  transactionDate: Date;
  merchant: string;
  amount: number;
  currency: string;

  // Classification
  category: string;
  subcategory?: string;
  transactionType: 'debit' | 'credit';

  // Source channel
  source?: 'email' | 'sms' | 'manual' | 'chat';

  // Banking Details (optional for manual transactions)
  accountNumber?: string;
  bankName?: string;

  // Additional fields
  note?: string;

  // Metadata (optional for manual transactions)
  rawEmailText?: string;
  extractedData?: Record<string, any>;
  confidence?: number;

  // Workflow Tracking (optional for manual transactions)
  workflowId?: string;
  workflowRunId?: string;

  processedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TransactionSchema = new Schema<ITransaction>({
  userId: { type: String, required: true, index: true },
  emailId: { type: String },
  emailSubject: { type: String },
  emailDate: { type: Date },
  emailFrom: { type: String },

  transactionDate: { type: Date, required: true, index: true },
  merchant: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'USD' },

  category: { type: String, required: true, index: true },
  subcategory: { type: String },
  transactionType: { type: String, enum: ['debit', 'credit'], required: true },

  source: { type: String, enum: ['email', 'sms', 'manual', 'chat'], default: 'email' },

  accountNumber: { type: String },
  bankName: { type: String },

  note: { type: String },

  rawEmailText: { type: String },
  extractedData: { type: Schema.Types.Mixed },
  confidence: { type: Number, min: 0, max: 1 },

  workflowId: { type: String },
  workflowRunId: { type: String },

  processedAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
  collection: 'transactions',
});

// Sparse unique index — allows multiple manual transactions (no emailId) per tenant
TransactionSchema.index({ userId: 1, emailId: 1 }, { unique: true, sparse: true });

TransactionSchema.index({ userId: 1, transactionDate: -1, category: 1 });
TransactionSchema.index({ userId: 1, workflowId: 1 }, { sparse: true });
TransactionSchema.index({ userId: 1, bankName: 1, accountNumber: 1 }, { sparse: true });

export const Transaction = model<ITransaction>('Transaction', TransactionSchema);
