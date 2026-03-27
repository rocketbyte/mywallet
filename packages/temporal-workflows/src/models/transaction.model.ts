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
  userId: { type: String, index: true },
  emailId: { type: String, index: true },
  emailSubject: { type: String },
  emailDate: { type: Date },
  emailFrom: { type: String },

  transactionDate: { type: Date, index: true },
  merchant: { type: String },
  amount: { type: Number },
  currency: { type: String, default: 'USD' },

  category: { type: String, index: true },
  subcategory: { type: String },
  transactionType: { type: String, enum: ['debit', 'credit'] },

  accountNumber: { type: String },
  bankName: { type: String },

  rawEmailText: { type: String },
  extractedData: { type: Schema.Types.Mixed },
  confidence: { type: Number, min: 0, max: 1 },

  workflowId: { type: String },
  workflowRunId: { type: String },

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
