import { Schema, model, Document } from 'mongoose';

export interface IBudget extends Document {
  // Tenant Identifier
  userId: string;            // Tenant/User identifier for multi-tenancy

  // Period
  month: number;
  year: number;

  // Budget Allocations
  categories: {
    category: string;
    budgetAmount: number;
    spentAmount: number;
    transactionCount: number;
  }[];

  // Totals
  totalBudget: number;
  totalSpent: number;

  // Metadata
  lastCalculatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BudgetSchema = new Schema<IBudget>({
  userId: { type: String, required: true, index: true },
  month: { type: Number, required: true, min: 1, max: 12 },
  year: { type: Number, required: true },

  categories: [{
    category: { type: String, required: true },
    budgetAmount: { type: Number, required: true },
    spentAmount: { type: Number, default: 0 },
    transactionCount: { type: Number, default: 0 }
  }],

  totalBudget: { type: Number, required: true },
  totalSpent: { type: Number, default: 0 },

  lastCalculatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true,
  collection: 'budgets'
});

// Compound unique index for per-tenant budgets (one budget per month/year per tenant)
BudgetSchema.index({ userId: 1, year: 1, month: 1 }, { unique: true });

export const Budget = model<IBudget>('Budget', BudgetSchema);
