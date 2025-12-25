import { Context } from '@temporalio/activity';
import { GmailClient } from './gmail-client';
import { FetchEmailsInput, Email } from '../../shared/types';

export const createGmailActivities = (gmailClient: GmailClient) => {
  return {
    /**
     * Fetch emails from Gmail based on search criteria
     */
    async fetchEmails(input: FetchEmailsInput): Promise<Email[]> {
      const { query, maxResults = 50, afterDate } = input;

      // Build Gmail search query
      let searchQuery = query;
      if (afterDate) {
        const dateStr = afterDate.toISOString().split('T')[0];
        searchQuery += ` after:${dateStr}`;
      }

      console.log('Fetching emails with query:', searchQuery);

      // Heartbeat for long-running operation
      Context.current().heartbeat();

      const messages = await gmailClient.searchMessages(searchQuery, maxResults);

      const emails: Email[] = [];

      for (const message of messages) {
        Context.current().heartbeat();

        const fullMessage = await gmailClient.getMessage(message.id!);

        const body = gmailClient.getMessageBody(fullMessage);
        const cleanBody = gmailClient.stripHtml(body);

        emails.push({
          id: fullMessage.id!,
          threadId: fullMessage.threadId!,
          from: gmailClient.getHeader(fullMessage, 'From'),
          subject: gmailClient.getHeader(fullMessage, 'Subject'),
          date: new Date(gmailClient.getHeader(fullMessage, 'Date')),
          body: cleanBody,
          snippet: fullMessage.snippet || ''
        });
      }

      console.log(`Fetched ${emails.length} emails`);
      return emails;
    },

    /**
     * Mark email as processed (add label)
     */
    async markEmailAsProcessed(emailId: string): Promise<void> {
      await gmailClient.addLabel(emailId, 'MYWALLET_PROCESSED');
      console.log(`Marked email ${emailId} as processed`);
    }
  };
};

export type GmailActivities = ReturnType<typeof createGmailActivities>;
