import { Context } from '@temporalio/activity';
import { Connection } from 'mongoose';
import { Email } from '../../models';
import {
  SaveEmailInput,
  SavedEmail,
  UpdateEmailProcessingInput,
  GetUnprocessedEmailsInput,
  EmailQueryInput,
  GetEmailsByIdsInput
} from '../../shared/types';

export const createEmailActivities = (mongoConnection: Connection) => {
  return {
    /**
     * Save raw email to MongoDB (with duplicate check)
     */
    async saveEmail(input: SaveEmailInput): Promise<SavedEmail> {
      Context.current().heartbeat();

      // Check if email already exists for THIS tenant (per-tenant deduplication)
      const existing = await Email.findOne({
        userId: input.userId,
        emailId: input.emailId
      });
      if (existing) {
        console.log('Email already exists:', input.emailId);
        return {
          id: existing._id.toString(),
          emailId: existing.emailId,
          subject: existing.subject,
          from: existing.from,
          date: existing.date,
          isProcessed: existing.isProcessed
        };
      }

      // Create new email document with userId
      const email = new Email({
        userId: input.userId,
        emailId: input.emailId,
        threadId: input.threadId,
        from: input.from,
        to: input.to,
        subject: input.subject,
        date: input.date,
        body: input.body,
        snippet: input.snippet,
        rawHtml: input.rawHtml,
        isProcessed: false,
        fetchedBy: input.fetchedBy,
        fetchedAt: new Date()
      });

      await email.save();

      console.log(`Email saved: ${email._id} - ${email.subject}`);

      return {
        id: email._id.toString(),
        emailId: email.emailId,
        subject: email.subject,
        from: email.from,
        date: email.date,
        isProcessed: email.isProcessed
      };
    },

    /**
     * Update email after processing
     */
    async updateEmailProcessing(input: UpdateEmailProcessingInput): Promise<void> {
      Context.current().heartbeat();

      await Email.findOneAndUpdate(
        {
          userId: input.userId,
          emailId: input.emailId
        },
        {
          isProcessed: input.isProcessed,
          processedAt: input.processedAt,
          processingWorkflowId: input.processingWorkflowId,
          matchedPatternId: input.matchedPatternId,
          matchedPatternName: input.matchedPatternName,
          transactionId: input.transactionId,
          confidence: input.confidence,
          processingError: input.processingError
        }
      );

      console.log(`Email processing updated: ${input.emailId}`);
    },

    /**
     * Get unprocessed emails for scheduled processing
     */
    async getUnprocessedEmails(input: GetUnprocessedEmailsInput): Promise<SavedEmail[]> {
      Context.current().heartbeat();

      const query: any = {
        userId: input.userId,
        isProcessed: false
      };

      if (input.fromAddress) {
        query.from = { $regex: input.fromAddress, $options: 'i' };
      }

      if (input.afterDate) {
        query.date = { $gte: input.afterDate };
      }

      const emails = await Email
        .find(query)
        .sort({ date: -1 })
        .limit(input.limit || 50);

      return emails.map(email => ({
        id: email._id.toString(),
        emailId: email.emailId,
        subject: email.subject,
        from: email.from,
        date: email.date,
        isProcessed: email.isProcessed
      }));
    },

    /**
     * Query emails (for API endpoints)
     */
    async queryEmails(input: EmailQueryInput) {
      Context.current().heartbeat();

      const query: any = {
        userId: input.userId  // Always filter by tenant
      };

      if (input.isProcessed !== undefined) {
        query.isProcessed = input.isProcessed;
      }

      if (input.fromAddress) {
        query.from = { $regex: input.fromAddress, $options: 'i' };
      }

      if (input.searchTerm) {
        query.$text = { $search: input.searchTerm };
      }

      if (input.startDate || input.endDate) {
        query.date = {};
        if (input.startDate) query.date.$gte = input.startDate;
        if (input.endDate) query.date.$lte = input.endDate;
      }

      const limit = input.limit || 50;
      const offset = input.offset || 0;

      const [emails, total] = await Promise.all([
        Email.find(query)
          .sort({ date: -1 })
          .skip(offset)
          .limit(limit),
        Email.countDocuments(query)
      ]);

      return {
        emails: emails.map(email => ({
          id: email._id.toString(),
          emailId: email.emailId,
          threadId: email.threadId,
          from: email.from,
          to: email.to,
          subject: email.subject,
          date: email.date,
          snippet: email.snippet,
          isProcessed: email.isProcessed,
          processedAt: email.processedAt,
          transactionId: email.transactionId,
          confidence: email.confidence,
          fetchedAt: email.fetchedAt
        })),
        total,
        limit,
        offset
      };
    },

    /**
     * Get email by ID (with tenant isolation)
     */
    async getEmailById(userId: string, emailId: string) {
      const email = await Email.findOne({
        userId,
        emailId
      });
      if (!email) return null;

      return {
        id: email._id.toString(),
        emailId: email.emailId,
        threadId: email.threadId,
        from: email.from,
        to: email.to,
        subject: email.subject,
        date: email.date,
        body: email.body,
        snippet: email.snippet,
        rawHtml: email.rawHtml,
        isProcessed: email.isProcessed,
        processedAt: email.processedAt,
        processingWorkflowId: email.processingWorkflowId,
        matchedPatternId: email.matchedPatternId,
        matchedPatternName: email.matchedPatternName,
        transactionId: email.transactionId,
        confidence: email.confidence,
        processingError: email.processingError,
        fetchedAt: email.fetchedAt,
        fetchedBy: email.fetchedBy,
        createdAt: email.createdAt,
        updatedAt: email.updatedAt
      };
    },

    /**
     * Get emails by IDs (for sync workflow processing)
     */
    async getEmailsByIds(input: GetEmailsByIdsInput): Promise<SavedEmail[]> {
      Context.current().heartbeat();

      const emails = await Email.find({
        userId: input.userId,
        emailId: { $in: input.emailIds }
      });

      return emails.map(email => ({
        id: email._id.toString(),
        emailId: email.emailId,
        subject: email.subject,
        from: email.from,
        date: email.date,
        isProcessed: email.isProcessed
      }));
    }
  };
};

export type EmailActivities = ReturnType<typeof createEmailActivities>;
