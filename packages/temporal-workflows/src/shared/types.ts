// Workflow Inputs/Outputs
export interface EmailProcessingInput {
  userId: string;            // NEW: Tenant identifier
  workflowId: string;
  workflowRunId: string;
  searchQuery?: string;      // Optional: for manual triggers
  emailIds?: string[];       // NEW: Process specific emails (from sync)
  maxResults?: number;
  afterDate?: Date;
}

export interface EmailProcessingResult {
  totalEmails: number;
  processedCount: number;
  failedCount: number;
  transactions: SavedTransaction[];
  errors: Array<{
    emailId: string;
    error: string;
    confidence?: number;
  }>;
}

// Activity Inputs/Outputs

// Gmail Activities
export interface FetchEmailsInput {
  userId: string;            // NEW: Tenant identifier
  query: string;
  maxResults?: number;
  afterDate?: Date;
}

export interface Email {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: Date;
  body: string;
  snippet: string;
}

// OpenAI Activities
export interface ExtractTransactionInput {
  emailId?: string;
  emailContent: string;
  emailSubject: string;
  emailFrom: string;
  emailDate: Date;
  extractionPrompt: string;
  bankName: string;
}

export interface ExtractedTransaction {
  transactionDate: Date;
  merchant: string;
  amount: number;
  currency: string;
  category: string;
  subcategory?: string;
  transactionType: 'debit' | 'credit';
  accountNumber: string;
  confidence: number;
  rawResponse: any;
}

// MongoDB Activities
export interface SaveTransactionInput {
  userId: string;            // NEW: Tenant identifier
  emailId: string;
  emailSubject: string;
  emailDate: Date;
  emailFrom: string;
  rawEmailText: string;
  extractedData: ExtractedTransaction;
  workflowId: string;
  workflowRunId: string;
}

export interface SavedTransaction {
  id: string;
  emailId: string;
  transactionDate: Date;
  merchant: string;
  amount: number;
  category: string;
}

export interface MatchEmailPatternInput {
  from: string;
  subject: string;
  body: string;
}

export interface MatchedPattern {
  id: string;
  name: string;
  bankName: string;
  extractionPrompt: string;
}

export interface UpdatePatternStatsInput {
  patternId: string;
  success: boolean;
}

// Transaction Query Types
export interface TransactionQueryParams {
  startDate?: Date;
  endDate?: Date;
  category?: string;
  minAmount?: number;
  maxAmount?: number;
  bankName?: string;
  page?: number;
  limit?: number;
}

export interface MonthlyStats {
  month: number;
  year: number;
  totalSpent: number;
  totalIncome: number;
  transactionCount: number;
  topCategories: {
    category: string;
    amount: number;
    count: number;
  }[];
}

export interface CategoryStats {
  category: string;
  totalAmount: number;
  transactionCount: number;
  averageAmount: number;
  percentage: number;
}

// Email Storage Types
export interface SaveEmailInput {
  userId: string;            // NEW: Tenant identifier
  emailId: string;
  threadId?: string;
  from: string;
  to: string;
  subject: string;
  date: Date;
  body?: string;
  snippet?: string;
  rawHtml?: string;
  fetchedBy: string;
}

export interface SavedEmail {
  id: string;
  emailId: string;
  subject: string;
  from: string;
  date: Date;
  body?: string;
  threadId?: string;
  snippet?: string;
  isProcessed: boolean;
}

export interface UpdateEmailProcessingInput {
  userId: string;            // NEW: Tenant identifier
  emailId: string;
  isProcessed: boolean;
  processedAt: Date;
  processingWorkflowId: string;
  matchedPatternId?: string;
  matchedPatternName?: string;
  transactionId?: string;
  confidence?: number;
  processingError?: string;
}

export interface GetUnprocessedEmailsInput {
  userId: string;            // NEW: Tenant identifier
  limit?: number;
  fromAddress?: string;
  afterDate?: Date;
}

export interface EmailQueryInput {
  userId: string;            // NEW: Tenant identifier (required)
  limit?: number;
  offset?: number;
  isProcessed?: boolean;
  fromAddress?: string;
  searchTerm?: string;
  startDate?: Date;
  endDate?: Date;
}

// Scheduled Workflow Types
export interface ScheduledEmailProcessingInput {
  userId: string;            // NEW: Tenant identifier
  scheduleId: string;
  searchQuery: string;
  maxResults: number;
  afterDate?: Date;
  skipProcessed: boolean;
}

export interface ScheduledEmailProcessingResult {
  scheduleId: string;
  runTimestamp: Date;
  emailsFetched: number;
  emailsStored: number;
  emailsProcessed: number;
  emailsFailed: number;
  duplicatesSkipped: number;
  transactions: SavedTransaction[];
  errors: Array<{
    emailId: string;
    error: string;
  }>;
}

// Schedule Management Types
export interface CreateScheduleInput {
  name: string;
  description?: string;
  searchQuery: string;
  cronExpression?: string;
  maxResults?: number;
  afterDate?: Date;
}

export interface ScheduleInfo {
  scheduleId: string;
  name: string;
  description?: string;
  isActive: boolean;
  searchQuery: string;
  cronExpression: string;
  nextRunTime?: Date;
  lastRunAt?: Date;
  lastRunStatus?: string;
  stats: {
    totalRuns: number;
    totalEmailsFetched: number;
    totalEmailsProcessed: number;
    totalErrors: number;
  };
}

// ==================== Gmail Sync Types ====================

// Workflow Inputs/Outputs
export interface GmailSubscriptionInput {
  userId: string;
  email: string;
  refreshToken: string;
  pubSubTopicName: string;
  workflowId: string;
}

export interface GmailSubscriptionResult {
  userId: string;
  workflowId: string;
  status: 'active' | 'stopped' | 'error';
  message: string;
}

// Activity Inputs/Outputs
export interface RefreshGmailTokenInput {
  userId: string;
  refreshToken: string;
}

export interface RefreshGmailTokenOutput {
  accessToken: string;
  expiresAt: Date;
}

export interface RenewGmailWatchInput {
  userId: string;
  accessToken: string;
  topicName: string;
}

export interface RenewGmailWatchOutput {
  historyId: string;
  expiration: Date;
}

export interface FetchGmailChangesInput {
  userId: string;
  accessToken: string;
  startHistoryId: string;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  historyId: string;
  internalDate: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  body: string;
  labels: string[];
}

export interface FetchGmailChangesOutput {
  messages: GmailMessage[];
  newHistoryId: string;
  changesCount: number;
}

export interface SaveGmailAccountInput {
  userId: string;
  email: string;
  refreshToken: string;
  workflowId: string;
  pubSubTopicName: string;
}

export interface UpdateGmailAccountInput {
  userId: string;
  accessToken?: string;
  accessTokenExpiresAt?: Date;
  watchExpiration?: Date;
  historyId?: string;
  lastSyncAt?: Date;
  totalEmailsSynced?: number;
  lastError?: string;
  errorCount?: number;
}

export interface GetGmailAccountInput {
  userId: string;
}

export interface DeactivateGmailAccountInput {
  userId: string;
}

// Signal Payloads
export interface IncomingWebhookSignal {
  emailAddress: string;
  historyId: string;
  timestamp: Date;
}

// Webhook Payload from Pub/Sub
export interface GmailWebhookPayload {
  message: {
    data: string;  // Base64 encoded JSON
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

export interface DecodedGmailNotification {
  emailAddress: string;
  historyId: string;
}

// NEW: Email Query by IDs (for sync workflow)
export interface GetEmailsByIdsInput {
  userId: string;
  emailIds: string[];
}

// NEW: Workflow Starter Activity (for triggering email processing from sync)
export interface StartEmailProcessingWorkflowInput {
  userId: string;
  emailIds: string[];
  workflowIdPrefix: string;
}

export interface StartEmailProcessingWorkflowOutput {
  workflowId: string;
  runId: string;
  emailCount: number;
}
