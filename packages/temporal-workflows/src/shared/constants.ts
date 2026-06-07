// Task Queue Names
export const TASK_QUEUES = {
  EMAIL_PROCESSING: 'email-processing-queue',
  TRANSACTION_ANALYSIS: 'transaction-analysis-queue',
  // Dedicated pipeline queue — worker runs with concurrency=1 to avoid
  // hammering the Ollama/LiteLLM instance with parallel AI calls.
  PIPELINE: 'pipeline-queue',
  // Dedicated queue for the monthly recurring-transactions job. Its activities
  // are pure DB writes (no AI), so its worker runs high activity concurrency,
  // isolated from the AI-throttled pipeline queue.
  RECURRING: 'recurring-queue'
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
  STORE_TRANSACTION: 'store_transaction',
  ANALYZE_DAY: 'analyze_day',
  ANALYZE_MONTH: 'analyze_month'
} as const;

// Hard ceiling on the daily summaries fed to the analyze_month prompt. A
// calendar month has at most 31, each ≤200 chars — bounded so the only AI
// input stays small regardless of how busy the month was.
export const MONTHLY_MAX_DAILY_SUMMARIES = 31;

// Max length of the monthly note rendered by the dashboard card. Sized for a
// 2–4 sentence opinionated advisor note (see the analyze_month prompt).
export const MONTHLY_NOTE_MAX_CHARS = 480;

// Number of prior short summaries fed to the analyze_day prompt as compact
// trend context. Bounded so prompt tokens stay small.
export const ANALYSIS_PRIOR_SUMMARIES = 7;

// Retry policy for the analysis workflow. Mirrors PIPELINE_RETRY_POLICY but
// is its own constant so it can diverge later.
export const ANALYSIS_RETRY_POLICY = {
  initialInterval: '5s' as any,
  backoffCoefficient: 2,
  maximumInterval: '60s' as any,
  maximumAttempts: 3,
  nonRetryableErrorTypes: ['PipelineStepNotFoundError', 'PipelineStepInactiveError']
};

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

// ==================== Recurring Transactions Job ====================

export const RECURRING_CONFIG = {
  /**
   * Cron for the global schedule: 00:00 every day. Each run copies the previous
   * month's recurrent transactions whose day-of-month matches that day.
   */
  CRON: '0 0 * * *',
  /**
   * Canonical id of the single global Temporal Schedule and its started workflow.
   * Both the standalone seed script and the deploy-time auto-seed upsert THIS id —
   * a fixed id is what guarantees there is ever exactly one schedule (no dupes).
   */
  SCHEDULE_ID: 'recurring-transactions-daily',
  WORKFLOW_TYPE: 'monthlyRecurringTransactionsWorkflow',
  /** Distinct userIds fetched per dispatcher page. */
  USER_PAGE_SIZE: 500,
  /** Recurrent source rows copied per activity call (per user). */
  ROW_PAGE_SIZE: 200,
  /** Children started per dispatcher iteration before continue-as-new. */
  USERS_PER_BATCH: 500,
  /**
   * Reset the dispatcher's history via continueAsNew once it grows past this,
   * so the job scales to arbitrarily many tenants (mirrors the Gmail watch
   * workflow's history-length guard).
   */
  CONTINUE_AS_NEW_HISTORY_LENGTH: 4_000,
} as const;

export const RECURRING_ACTIVITY_TIMEOUTS = {
  LIST_USERS: '1 minute',
  COPY_PAGE: '2 minutes',
} as const;

export const RECURRING_RETRY_POLICY = {
  initialInterval: '1s' as any,
  backoffCoefficient: 2,
  maximumInterval: '30s' as any,
  maximumAttempts: 10,
};

// ==================== Signal Names ====================

// Signal Names
export const GMAIL_SIGNALS = {
  INCOMING_WEBHOOK: 'incomingWebhook',
  STOP_SYNC: 'stopSync',
  /** Force an immediate token refresh from outside the workflow (e.g. after re-auth) */
  FORCE_TOKEN_REFRESH: 'forceTokenRefresh'
} as const;
