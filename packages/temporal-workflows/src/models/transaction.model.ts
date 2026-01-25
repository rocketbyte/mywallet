import { Schema, model, Document } from 'mongoose';

export interface ITransaction extends Document {
  // Tenant Identifier
  userId: string;            // Tenant/User identifier for multi-tenancy

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
  userId: { type: String, required: true, index: true },
  emailId: { type: String, required: true, index: true },  // Removed unique: true
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

// Compound unique index for per-tenant deduplication (one transaction per email per tenant)
TransactionSchema.index({ userId: 1, emailId: 1 }, { unique: true });

// Indexes for common queries (with userId prefix for tenant isolation)
TransactionSchema.index({ userId: 1, transactionDate: -1, category: 1 });
TransactionSchema.index({ userId: 1, workflowId: 1 });
TransactionSchema.index({ userId: 1, bankName: 1, accountNumber: 1 });

export const Transaction = model<ITransaction>('Transaction', TransactionSchema);
