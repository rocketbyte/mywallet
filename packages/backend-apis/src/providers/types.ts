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
 * Contract every email provider must fulfill.
 * Adding a new provider (Outlook, Yahoo, etc.) means implementing this interface
 * and registering it in the corresponding route file.
 */
export interface IEmailProvider {
  readonly type: string;

  /** Returns the OAuth authorization URL. Embeds userId in state so the
   *  callback can auto-link without an extra API call. */
  getAuthUrl(userId?: string): string;

  /** Exchanges the authorization code for credentials and returns the
   *  authenticated email + refresh token. */
  exchangeCode(code: string): Promise<{ email: string; refreshToken: string }>;

  /** Starts the provider-specific sync workflow for a user. */
  linkAccount(input: LinkAccountInput): Promise<LinkAccountResult>;

  /** Stops the sync workflow and marks the account inactive. */
  unlinkAccount(userId: string): Promise<void>;

  /** Returns the current sync status for a linked account. */
  getAccountStatus(userId: string): Promise<AccountStatus>;
}
