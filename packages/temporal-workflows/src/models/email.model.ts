import { Schema, model, Document } from 'mongoose';

export interface IEmail extends Document {
  // Tenant Identifier
  userId: string;            // Tenant/User identifier for multi-tenancy

  // Gmail Identifiers
  emailId: string;           // Gmail message ID (unique per tenant)
  threadId: string;          // Gmail thread ID

  // Email Headers
  from: string;
  to: string;
  subject: string;
  date: Date;

  // Email Content
  body: string;              // Plain text body (HTML stripped)
  snippet: string;           // Gmail snippet
  rawHtml?: string;          // Optional: full HTML if needed

  // Processing Status
  isProcessed: boolean;      // Has this been processed?
  processedAt?: Date;        // When was it processed?
  processingWorkflowId?: string;  // Which workflow processed it

  // Pattern Matching
  matchedPatternId?: string; // Which pattern matched
  matchedPatternName?: string;

  // Transaction Link
  transactionId?: string;    // Link to extracted transaction (if any)

  // Processing Metadata
  processingError?: string;  // Error message if processing failed
  confidence?: number;       // Extraction confidence (if processed)

  // Audit Fields
  createdAt: Date;
  updatedAt: Date;
  fetchedAt: Date;          // When was this email fetched from Gmail
  fetchedBy: string;        // Which workflow/schedule fetched it
}

const EmailSchema = new Schema<IEmail>({
  userId: {
    type: String,
    required: true,
    index: true
  },
  emailId: {
    type: String,
    required: true,
    index: true  // Removed unique: true - will use compound unique index instead
  },
  threadId: {
    type: String,
    required: true,
    index: true
  },

  from: { type: String, required: true, index: true },
  to: { type: String, required: true },
  subject: { type: String, required: true },
  date: { type: Date, required: true, index: true },

  body: { type: String, required: true },
  snippet: { type: String, required: true },
  rawHtml: { type: String },

  isProcessed: { type: Boolean, default: false, index: true },
  processedAt: { type: Date },
  processingWorkflowId: { type: String, index: true },

  matchedPatternId: { type: String },
  matchedPatternName: { type: String },

  transactionId: { type: String, index: true },

  processingError: { type: String },
  confidence: { type: Number, min: 0, max: 1 },

  fetchedAt: { type: Date, default: Date.now },
  fetchedBy: { type: String, required: true }
}, {
  timestamps: true,
  collection: 'emails'
});

// Compound unique index for per-tenant deduplication
EmailSchema.index({ userId: 1, emailId: 1 }, { unique: true });

// Compound indexes for efficient queries (with userId prefix for tenant isolation)
EmailSchema.index({ userId: 1, isProcessed: 1, date: -1 });
EmailSchema.index({ userId: 1, from: 1, isProcessed: 1 });
EmailSchema.index({ subject: 'text', body: 'text' }); // Text search index

export const Email = model<IEmail>('Email', EmailSchema);
