export type EmailProviderType = 'gmail' | 'outlook';

export interface AuthorizationContext {
  userId: string;
  email: string;
}

export interface AuthState {
  userId: string;
  email: string;
  provider: EmailProviderType;
}

export interface LinkAccountInput {
  userId: string;
  email: string;
  refreshToken: string;
  pubSubTopicName?: string;
}

export interface LinkAccountResult {
  userId: string;
  workflowId: string;
}

export interface AccountStatus {
  userId: string;
  email: string;
  isActive: boolean;
  workflowId: string;
  workflowStatus: string;
  watchExpiration?: Date;
  lastSyncAt?: Date;
  totalEmailsSynced: number;
  lastError?: string;
  errorCount: number;
}

/**
 * Contract every email provider must fulfill. Add a new provider by
 * implementing this interface and registering an instance in the
 * EmailProviderRegistry — no other call sites need to change.
 */
export interface IEmailProvider {
  readonly type: EmailProviderType;

  /**
   * Returns the OAuth authorization URL. The context is embedded in the
   * `state` parameter so the callback can verify and auto-link.
   */
  getAuthUrl(ctx: AuthorizationContext): string;

  /**
   * Exchanges the authorization code for credentials and returns the
   * authenticated email + refresh token.
   */
  exchangeCode(code: string): Promise<{ email: string; refreshToken: string }>;

  /** Starts the provider-specific sync workflow for a user. */
  linkAccount(input: LinkAccountInput): Promise<LinkAccountResult>;

  /** Stops the sync workflow and marks the account inactive. */
  unlinkAccount(userId: string): Promise<void>;

  /** Returns the current sync status for a linked account. */
  getAccountStatus(userId: string): Promise<AccountStatus>;
}
