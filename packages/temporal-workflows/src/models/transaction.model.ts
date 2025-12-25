import { Schema, model, Document } from 'mongoose';

export interface ITransaction extends Document {
  // Source Information
  emailId: string;
  emailSubject: string;
  emailDate: Date;
  emailFrom: string;

  // Transaction Details
  transactionDate: Date;
  merchant: string;
  amount: number;
  currency: string;

  // Classification
  category: string;
  subcategory?: string;
  transactionType: 'debit' | 'credit';

  // Banking Details
  accountNumber: string;
  bankName: string;

  // Metadata
  rawEmailText: string;
  extractedData: Record<string, any>;
  confidence: number;

  // Workflow Tracking
  workflowId: string;
  workflowRunId: string;

  // Timestamps
  processedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TransactionSchema = new Schema<ITransaction>({
  emailId: { type: String, required: true, unique: true, index: true },
  emailSubject: { type: String, required: true },
  emailDate: { type: Date, required: true },
  emailFrom: { type: String, required: true },

  transactionDate: { type: Date, required: true, index: true },
  merchant: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, required: true, default: 'USD' },

  category: { type: String, required: true, index: true },
  subcategory: { type: String },
  transactionType: { type: String, enum: ['debit', 'credit'], required: true },

  accountNumber: { type: String, required: true },
  bankName: { type: String, required: true },

  rawEmailText: { type: String, required: true },
  extractedData: { type: Schema.Types.Mixed },
  confidence: { type: Number, min: 0, max: 1 },

  workflowId: { type: String, required: true },
  workflowRunId: { type: String, required: true },

  processedAt: { type: Date, default: Date.now }
}, {
  timestamps: true,
  collection: 'transactions'
});

// Indexes for common queries
TransactionSchema.index({ transactionDate: -1, category: 1 });
TransactionSchema.index({ workflowId: 1 });
TransactionSchema.index({ bankName: 1, accountNumber: 1 });

export const Transaction = model<ITransaction>('Transaction', TransactionSchema);
