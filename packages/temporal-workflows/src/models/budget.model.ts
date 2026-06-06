import { Schema, model, Document } from 'mongoose';

export interface BudgetInterface extends Document {
  userId: string;
  month?: number;
  year?: number;
  categories?: {
    category: string;
    budgetAmount: number;
    spentAmount: number;
    transactionCount: number;
  }[];
  totalBudget?: number;
  totalSpent?: number;
  /** When true, the budget cap and category limits are locked from edits in the UI. */
  locked?: boolean;
  lastCalculatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BudgetSchema = new Schema<BudgetInterface>({
  userId: { type: String, required: true, index: true },
  month: { type: Number, min: 1, max: 12 },
  year: { type: Number },
  categories: [{
    category: { type: String },
    budgetAmount: { type: Number },
    spentAmount: { type: Number, default: 0 },
    transactionCount: { type: Number, default: 0 },
  }],
  totalBudget: { type: Number },
  totalSpent: { type: Number, default: 0 },
  locked: { type: Boolean, default: false },
  lastCalculatedAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
  collection: 'budgets',
});

BudgetSchema.index({ userId: 1, year: 1, month: 1 }, { unique: true });

export const Budget = model<BudgetInterface>('Budget', BudgetSchema);
