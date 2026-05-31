import { Schema, model, Document, Types } from 'mongoose';

import { AnalysisStatus } from './transaction-analysis.model';

export interface MonthlyAnalysisBudgetSnapshot {
  totalBudget: number;
  totalSpent: number;
  percentUsed: number;
  daysRemainingInPeriod: number;
}

export interface MonthlyAnalysisInputs {
  dailyCount: number;
  totals: { income: number; expenses: number; net: number };
  balance: number;
  budgetSnapshot: MonthlyAnalysisBudgetSnapshot | null;
  /**
   * Stable hash over the ordered daily summaries + numeric block. Lets the
   * workflow skip the AI call entirely when nothing changed since the last
   * successful run (zero tokens spent).
   */
  sourceHash: string;
}

export interface MonthlyAnalysisModelMeta {
  model: string;
  promptVersion: number;
  tokensIn: number;
  tokensOut: number;
}

export interface MonthlyAnalysisInterface extends Document {
  _id: Types.ObjectId;
  userId: string;
  year: number;
  /** 1-based calendar month (1–12). */
  month: number;
  currency: string;
  inputs: MonthlyAnalysisInputs;
  /** Short markdown paragraph rendered by the dashboard MONTHLY NOTE card. */
  note: string;
  modelMeta: MonthlyAnalysisModelMeta;
  status: AnalysisStatus;
  failureReason?: string;
  generatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BudgetSnapshotSchema = new Schema(
  {
    totalBudget: { type: Number, required: true },
    totalSpent: { type: Number, required: true },
    percentUsed: { type: Number, required: true },
    daysRemainingInPeriod: { type: Number, required: true },
  },
  { _id: false }
);

const InputsSchema = new Schema(
  {
    dailyCount: { type: Number, required: true },
    totals: new Schema(
      {
        income: { type: Number, required: true },
        expenses: { type: Number, required: true },
        net: { type: Number, required: true },
      },
      { _id: false }
    ),
    balance: { type: Number, required: true },
    budgetSnapshot: { type: BudgetSnapshotSchema, default: null },
    sourceHash: { type: String, required: true, default: '' },
  },
  { _id: false }
);

const ModelMetaSchema = new Schema<MonthlyAnalysisModelMeta>(
  {
    model: { type: String, required: true },
    promptVersion: { type: Number, required: true },
    tokensIn: { type: Number, default: 0 },
    tokensOut: { type: Number, default: 0 },
  },
  { _id: false }
);

const MonthlyAnalysisSchema = new Schema<MonthlyAnalysisInterface>(
  {
    userId: { type: String, required: true, index: true },
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    currency: { type: String, required: true, default: 'USD' },
    inputs: { type: InputsSchema, required: true },
    note: { type: String, default: '' },
    modelMeta: { type: ModelMetaSchema, required: true },
    status: { type: String, enum: ['ready', 'failed'], required: true, default: 'ready' },
    failureReason: { type: String },
    generatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true, collection: 'monthly_analyses' }
);

MonthlyAnalysisSchema.index({ userId: 1, year: 1, month: 1 }, { unique: true });
MonthlyAnalysisSchema.index({ userId: 1, year: -1, month: -1 });

export const MonthlyAnalysis = model<MonthlyAnalysisInterface>(
  'MonthlyAnalysis',
  MonthlyAnalysisSchema
);
