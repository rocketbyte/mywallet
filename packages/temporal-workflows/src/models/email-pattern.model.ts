import { Schema, model, Document } from 'mongoose';

export interface IEmailPattern extends Document {
  // Pattern Identity
  name: string;
  bankName: string;
  accountType: 'credit' | 'debit' | 'checking' | 'savings';

  // Email Matching Criteria
  fromAddresses: string[];
  subjectPatterns: string[];
  bodyKeywords: string[];

  // Extraction Configuration
  extractionPrompt: string;

  // Pattern Metadata
  isActive: boolean;
  priority: number;

  // Statistics
  matchCount: number;
  successRate: number;
  lastMatchedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

const EmailPatternSchema = new Schema<IEmailPattern>({
  name: { type: String, required: true, unique: true },
  bankName: { type: String, required: true },
  accountType: {
    type: String,
    enum: ['credit', 'debit', 'checking', 'savings'],
    required: true
  },

  fromAddresses: [{ type: String, required: true }],
  subjectPatterns: [{ type: String, required: true }],
  bodyKeywords: [{ type: String }],

  extractionPrompt: { type: String, required: true },

  isActive: { type: Boolean, default: true },
  priority: { type: Number, default: 0 },

  matchCount: { type: Number, default: 0 },
  successRate: { type: Number, default: 0 },
  lastMatchedAt: { type: Date }
}, {
  timestamps: true,
  collection: 'email_patterns'
});

EmailPatternSchema.index({ isActive: 1, priority: -1 });
EmailPatternSchema.index({ bankName: 1 });

export const EmailPattern = model<IEmailPattern>('EmailPattern', EmailPatternSchema);
