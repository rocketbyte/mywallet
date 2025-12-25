import { Schema, model, Document } from 'mongoose';

export interface IGmailAccount extends Document {
  // User Association
  userId: string;                    // Unique user identifier
  email: string;                     // Gmail address

  // OAuth Tokens
  refreshToken: string;              // Long-lived refresh token
  currentAccessToken?: string;       // Current access token (short-lived)
  accessTokenExpiresAt?: Date;      // When access token expires

  // Gmail Watch Subscription
  watchExpiration?: Date;            // When Gmail watch expires
  historyId?: string;                // Last processed history ID
  lastSyncAt?: Date;                 // Last successful sync timestamp

  // Workflow Management
  workflowId: string;                // Associated Temporal workflow ID
  isActive: boolean;                 // Is sync currently active?

  // Pub/Sub Configuration
  pubSubTopicName: string;          // GCP Pub/Sub topic for notifications
  pubSubSubscription?: string;       // GCP Pub/Sub subscription ID

  // Statistics
  totalEmailsSynced: number;
  lastError?: string;
  errorCount: number;

  // Audit Fields
  createdAt: Date;
  updatedAt: Date;
}

const GmailAccountSchema = new Schema<IGmailAccount>({
  userId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    index: true
  },

  refreshToken: {
    type: String,
    required: true,
    select: false  // Don't return in queries by default for security
  },
  currentAccessToken: {
    type: String,
    select: false
  },
  accessTokenExpiresAt: {
    type: Date
  },

  watchExpiration: {
    type: Date,
    index: true
  },
  historyId: {
    type: String
  },
  lastSyncAt: {
    type: Date
  },

  workflowId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },

  pubSubTopicName: {
    type: String,
    required: true
  },
  pubSubSubscription: {
    type: String
  },

  totalEmailsSynced: {
    type: Number,
    default: 0
  },
  lastError: {
    type: String
  },
  errorCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true,
  collection: 'gmail_accounts'
});

// Compound indexes
GmailAccountSchema.index({ isActive: 1, watchExpiration: 1 });
GmailAccountSchema.index({ userId: 1, isActive: 1 });

export const GmailAccount = model<IGmailAccount>('GmailAccount', GmailAccountSchema);
