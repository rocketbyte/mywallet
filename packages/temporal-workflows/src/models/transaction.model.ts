import { Schema, model, Document } from 'mongoose';

export interface TransactionInterface extends Document {
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
  source?: 'email' | 'sms' | 'manual' | 'chat' | 'recurring';

  // Banking Details (optional for manual transactions)
  accountNumber?: string;
  bankName?: string;

  // Additional fields
  note?: string;

  /**
   * User-marked recurring fixed expense (rent, subscriptions, …). Set through
   * the transactions API; propagated across all transactions sharing the same
   * category/amount/merchant signature for the user.
   */
  isFixedExpense: boolean;

  /**
   * User-marked recurrent transaction. When true, the monthly recurring job
   * clones this row into the next month (preserving the flag, so the series
   * perpetuates). Independent of `isFixedExpense`.
   */
  isRecurrent: boolean;

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

const TransactionSchema = new Schema<TransactionInterface>({
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

  source: { type: String, enum: ['email', 'sms', 'manual', 'chat', 'recurring'], default: 'email' },

  accountNumber: { type: String },
  bankName: { type: String },

  note: { type: String },
  isFixedExpense: { type: Boolean, default: false },
  isRecurrent: { type: Boolean, default: false },

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
// Supports the list endpoint's category filter: equality on category with the
// transactionDate-desc sort served straight from the index (no in-memory sort).
TransactionSchema.index({ userId: 1, category: 1, transactionDate: -1 });
TransactionSchema.index({ userId: 1, workflowId: 1 }, { sparse: true });
TransactionSchema.index({ userId: 1, bankName: 1, accountNumber: 1 }, { sparse: true });

// Supports fixed-expense propagation: marking one transaction updates every
// other row for the user that shares the same (category, amount, merchant).
TransactionSchema.index({ userId: 1, category: 1, amount: 1, merchant: 1 });

// Supports the monthly recurring job's cross-tenant scan for the previous
// month's recurrent rows (distinct users, then per-user paging).
TransactionSchema.index({ isRecurrent: 1, transactionDate: 1, userId: 1 });

// Supports findRecentDuplicate — exact-match dedup query during pipeline storage.
TransactionSchema.index(
  { userId: 1, transactionType: 1, currency: 1, amount: 1, transactionDate: -1 },
  { name: 'dedup_lookup' }
);

export const Transaction = model<TransactionInterface>('Transaction', TransactionSchema);
