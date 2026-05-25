// Task Queue Names
export const TASK_QUEUES = {
  EMAIL_PROCESSING: 'email-processing-queue',
  TRANSACTION_ANALYSIS: 'transaction-analysis-queue',
  // Dedicated pipeline queue — worker runs with concurrency=1 to avoid
  // hammering the Ollama/LiteLLM instance with parallel AI calls.
  PIPELINE: 'pipeline-queue'
} as const;

// Workflow ID Prefixes
export const WORKFLOW_IDS = {
  EMAIL_PROCESSING_PREFIX: 'email-processing',
  PIPELINE_PREFIX: 'pipeline-agent'
} as const;

// Activity Timeouts
export const ACTIVITY_TIMEOUTS = {
  GMAIL_FETCH: '5 minutes',
  OPENAI_EXTRACT: '2 minutes',
  DB_OPERATION: '30 seconds'
} as const;

// Retry Policy Configurations
export const RETRY_POLICIES = {
  GMAIL: {
    initialInterval: '2s' as any,
    backoffCoefficient: 2,
    maximumInterval: '60s' as any,
    maximumAttempts: 5,
    nonRetryableErrorTypes: ['AuthenticationError']
  },
  OPENAI: {
    initialInterval: '1s' as any,
    backoffCoefficient: 2,
    maximumInterval: '30s' as any,
    maximumAttempts: 3,
    nonRetryableErrorTypes: ['InvalidRequestError', 'AuthenticationError']
  },
  MONGODB: {
    initialInterval: '500ms' as any,
    backoffCoefficient: 2,
    maximumInterval: '10s' as any,
    maximumAttempts: 5
  }
};

// Transaction Categories
export const TRANSACTION_CATEGORIES = [
  'Food',
  'Transport',
  'Shopping',
  'Bills',
  'Entertainment',
  'Healthcare',
  'Travel',
  'Education',
  'Personal',
  'Other'
] as const;

export type TransactionCategory = typeof TRANSACTION_CATEGORIES[number];

// Confidence Threshold
export const CONFIDENCE_THRESHOLD = 0.7;

// Rate Limiting
export const RATE_LIMITS = {
  MAX_CONCURRENT_ACTIVITIES: 5,
  EMAIL_PROCESSING_DELAY_MS: 100
} as const;

// ==================== Gmail Sync Constants ====================

// Task Queue for Gmail Sync
export const GMAIL_SYNC_TASK_QUEUE = 'gmail-sync-queue';

// Workflow ID Prefix
export const GMAIL_SUBSCRIPTION_WORKFLOW_PREFIX = 'gmail-watch-';

// Activity Timeouts for Gmail Sync
export const GMAIL_SYNC_TIMEOUTS = {
  REFRESH_TOKEN: '30 seconds',
  RENEW_WATCH: '1 minute',
  FETCH_CHANGES: '2 minutes',
  DB_OPERATION: '30 seconds'
} as const;

/**
 * Token refresh configuration.
 *
 * Access tokens issued by Google last ~60 minutes. We refresh proactively
 * every PROACTIVE_REFRESH_INTERVAL_MINUTES and also whenever fewer than
 * REFRESH_BEFORE_EXPIRY_MINUTES remain on the current token.
 *
 * REVOCATION_ERROR_TYPES are treated as non-retryable — when they occur the
 * refresh token has been permanently revoked by the user or by Google.
 */
export const TOKEN_REFRESH_CONFIG = {
  /** Refresh the token when fewer than this many minutes remain */
  REFRESH_BEFORE_EXPIRY_MINUTES: 10,
  /** Proactively refresh every N minutes regardless of expiry */
  PROACTIVE_REFRESH_INTERVAL_MINUTES: 45,
  /** Error message substrings that indicate a permanently revoked token */
  REVOCATION_ERROR_TYPES: [
    'invalid_grant',
    'InvalidGrantError',
    'Token has been expired or revoked'
  ]
} as const;

// Retry Policies for Gmail Sync
export const GMAIL_SYNC_RETRY_POLICIES = {
  GMAIL_API: {
    initialInterval: '2s' as any,
    backoffCoefficient: 2,
    maximumInterval: '60s' as any,
    maximumAttempts: 5,
    nonRetryableErrorTypes: ['InvalidGrantError', 'AuthenticationError']
  },
  DB_OPERATION: {
    initialInterval: '500ms' as any,
    backoffCoefficient: 2,
    maximumInterval: '10s' as any,
    maximumAttempts: 5
  }
};

// Gmail Watch Configuration
export const GMAIL_WATCH_CONFIG = {
  EXPIRATION_DAYS: 7,                  // Gmail max is 7 days
  RENEWAL_BUFFER_DAYS: 5,              // Renew 2 days before expiration
  RENEWAL_CHECK_INTERVAL: '1 day',
  CONTINUE_AS_NEW_DAYS: 7,             // Reset workflow history at least weekly
  CONTINUE_AS_NEW_HISTORY_LENGTH: 5_000 // Reset whenever history outgrows the 10s WFT replay budget
} as const;

// ==================== AI Pipeline Constants ====================

export const PIPELINE_STEP_KEYS = {
  CLASSIFY_EMAIL: 'classify_email',
  EXTRACT_TRANSACTION: 'extract_transaction',
  STORE_TRANSACTION: 'store_transaction'
} as const;

// Deduplication: skip storage when a transaction with the same userId,
// transactionType, currency, and exact amount was stored within this window.
export const DUPLICATE_LOOKBACK_HOURS = 48;

export const PIPELINE_ACTIVITY_TIMEOUTS = {
  // Generous ceiling for slow local LLM inference (Ollama on a Pi can take minutes).
  // Liveness is enforced by heartbeatTimeout — the activity heartbeats every 20s
  // during the AI call so Temporal retries quickly if the worker crashes.
  AI_CALL: '1 hour',
  STORE: '30 seconds'
} as const;

// If the worker dies mid-activity Temporal will reschedule after this window.
export const PIPELINE_HEARTBEAT_TIMEOUT = '2 minutes';

export const PIPELINE_RETRY_POLICY = {
  initialInterval: '5s' as any,
  backoffCoefficient: 2,
  maximumInterval: '60s' as any,
  maximumAttempts: 3,
  nonRetryableErrorTypes: ['PipelineStepNotFoundError', 'PipelineStepInactiveError', 'AuthenticationError']
};

// Minimum confidence for the classify step to proceed to extraction
export const CLASSIFICATION_CONFIDENCE_THRESHOLD = 0.7;

// ==================== Signal Names ====================

// Signal Names
export const GMAIL_SIGNALS = {
  INCOMING_WEBHOOK: 'incomingWebhook',
  STOP_SYNC: 'stopSync',
  /** Force an immediate token refresh from outside the workflow (e.g. after re-auth) */
  FORCE_TOKEN_REFRESH: 'forceTokenRefresh'
} as const;
