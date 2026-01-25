import { Schema, model, Document } from 'mongoose';

export interface IScheduleConfig extends Document {
  // Tenant Identifier
  userId: string;             // Tenant/User identifier (owner of this schedule)

  // Schedule Identity
  scheduleId: string;         // Temporal schedule ID (globally unique)
  name: string;               // User-friendly name
  description?: string;

  // Schedule Configuration
  isActive: boolean;          // Is schedule running?
  searchQuery: string;        // Gmail search query
  cronExpression: string;     // Cron schedule (default: "* * * * *" for every minute)
  maxResults: number;         // Max emails per run

  // Processing Options
  afterDate?: Date;           // Only fetch emails after this date
  skipProcessed: boolean;     // Skip emails already in DB

  // Statistics
  totalRuns: number;
  lastRunAt?: Date;
  lastRunStatus?: 'success' | 'failure';
  totalEmailsFetched: number;
  totalEmailsProcessed: number;
  totalErrors: number;

  // Audit
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;          // Future: user ID
}

const ScheduleConfigSchema = new Schema<IScheduleConfig>({
  userId: { type: String, required: true, index: true },
  scheduleId: {
    type: String,
    required: true,
    unique: true,  // Keep: Temporal schedule IDs are globally unique
    index: true
  },
  name: { type: String, required: true },
  description: { type: String },

  isActive: { type: Boolean, default: true },
  searchQuery: {
    type: String,
    required: true,
    default: 'subject:"Usaste tu tarjeta de credito"'
  },
  cronExpression: {
    type: String,
    required: true,
    default: '* * * * *'  // Every minute
  },
  maxResults: { type: Number, default: 50 },

  afterDate: { type: Date },
  skipProcessed: { type: Boolean, default: true },

  totalRuns: { type: Number, default: 0 },
  lastRunAt: { type: Date },
  lastRunStatus: {
    type: String,
    enum: ['success', 'failure']
  },
  totalEmailsFetched: { type: Number, default: 0 },
  totalEmailsProcessed: { type: Number, default: 0 },
  totalErrors: { type: Number, default: 0 },

  createdBy: { type: String, default: 'system' }
}, {
  timestamps: true,
  collection: 'schedule_configs'
});

// Index for querying user's schedules
ScheduleConfigSchema.index({ userId: 1, isActive: 1 });

export const ScheduleConfig = model<IScheduleConfig>('ScheduleConfig', ScheduleConfigSchema);
