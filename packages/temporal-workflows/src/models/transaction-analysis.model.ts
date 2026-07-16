import { Schema, model, Document, Types } from 'mongoose';

export type AnalysisStatus = 'ready' | 'failed';
export type SuggestionUrgency = 'info' | 'warn' | 'urgent';

export interface AnalysisSuggestion {
  id: string;
  title: string;
  body: string;
  urgency: SuggestionUrgency;
  category?: string;
}

export interface AnalysisInputs {
  transactionCount: number;
  totals: { income: number; expenses: number; net: number };
  balance: number;
  budgetSnapshot: {
    totalBudget: number;
    totalSpent: number;
    percentUsed: number;
    daysRemainingInPeriod: number;
  } | null;
}

export interface AnalysisToolCall {
  name: string;
  args: Record<string, unknown>;
  ms: number;
}

export interface AnalysisModelMeta {
  model: string;
  promptVersion: number;
  tokensIn: number;
  tokensOut: number;
  /** Tool calls the model made while producing this report (observability). */
  toolCalls?: AnalysisToolCall[];
}

export interface TransactionAnalysisInterface extends Document {
  _id: Types.ObjectId;
  userId: string;
  analysisDate: Date;
  currency: string;
  /** Language the report text was written in ('en' | 'es'). */
  language: string;
  inputs: AnalysisInputs;
  summary: string;
  fullSummary: string;
  suggestions: AnalysisSuggestion[];
  modelMeta: AnalysisModelMeta;
  status: AnalysisStatus;
  failureReason?: string;
  generatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SuggestionSchema = new Schema<AnalysisSuggestion>(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    urgency: { type: String, enum: ['info', 'warn', 'urgent'], required: true },
    category: { type: String },
  },
  { _id: false }
);

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
    transactionCount: { type: Number, required: true },
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
  },
  { _id: false }
);

const ToolCallSchema = new Schema<AnalysisToolCall>(
  {
    name: { type: String, required: true },
    args: { type: Schema.Types.Mixed, default: {} },
    ms: { type: Number, default: 0 },
  },
  { _id: false }
);

const ModelMetaSchema = new Schema<AnalysisModelMeta>(
  {
    model: { type: String, required: true },
    promptVersion: { type: Number, required: true },
    tokensIn: { type: Number, default: 0 },
    tokensOut: { type: Number, default: 0 },
    toolCalls: { type: [ToolCallSchema], default: undefined },
  },
  { _id: false }
);

const TransactionAnalysisSchema = new Schema<TransactionAnalysisInterface>(
  {
    userId: { type: String, required: true, index: true },
    analysisDate: { type: Date, required: true },
    currency: { type: String, required: true, default: 'USD' },
    language: { type: String, enum: ['en', 'es'], default: 'en' },
    inputs: { type: InputsSchema, required: true },
    summary: { type: String, default: '' },
    fullSummary: { type: String, default: '' },
    suggestions: { type: [SuggestionSchema], default: [] },
    modelMeta: { type: ModelMetaSchema, required: true },
    status: { type: String, enum: ['ready', 'failed'], required: true, default: 'ready' },
    failureReason: { type: String },
    generatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true, collection: 'transaction_analyses' }
);

TransactionAnalysisSchema.index({ userId: 1, analysisDate: 1 }, { unique: true });
TransactionAnalysisSchema.index({ userId: 1, generatedAt: -1 });

export const TransactionAnalysis = model<TransactionAnalysisInterface>(
  'TransactionAnalysis',
  TransactionAnalysisSchema
);
