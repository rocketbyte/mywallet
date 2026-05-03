import {
  FetchGmailChangesInput,
  FetchGmailChangesOutput,
  RefreshGmailTokenInput,
  RefreshGmailTokenOutput,
  RenewGmailWatchInput,
  RenewGmailWatchOutput,
} from '../../../shared/types';

/**
 * Mail Sync Gateway Interface (Layer 2 - Application Layer)
 * Defines the contract for an external Mail Sync provider (e.g. Gmail Push Notifications)
 * Decouples the application logic and Temporal activities from a specific Mail Provider.
 */
export interface MailSyncGatewayInterface {
  /**
   * Refreshes the mail provider access token using a refresh token.
   */
  refreshAccessToken(input: RefreshGmailTokenInput): Promise<RefreshGmailTokenOutput>;

  /**
   * Renews the watch/push subscription for a specific topic.
   */
  renewWatch(input: RenewGmailWatchInput): Promise<RenewGmailWatchOutput>;

  /**
   * Stops the watch/push subscription.
   */
  stopWatch(accessToken: string): Promise<void>;

  /**
   * Fetches changes/new messages since a specific history marker.
   */
  fetchChanges(input: FetchGmailChangesInput): Promise<FetchGmailChangesOutput>;
}
