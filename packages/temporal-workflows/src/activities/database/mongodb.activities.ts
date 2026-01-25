import { Context } from '@temporalio/activity';
import { Connection } from 'mongoose';
import { Transaction, EmailPattern } from '../../models';
import {
  SaveTransactionInput,
  SavedTransaction,
  MatchEmailPatternInput,
  MatchedPattern,
  UpdatePatternStatsInput
} from '../../shared/types';

export const createMongoDBActivities = (mongoConnection: Connection) => {
  return {
    /**
     * Save extracted transaction to MongoDB
     */
    async saveTransaction(input: SaveTransactionInput): Promise<SavedTransaction> {
      Context.current().heartbeat();

      // Check if transaction already exists for THIS tenant (per-tenant deduplication)
      const existing = await Transaction.findOne({
        userId: input.userId,
        emailId: input.emailId
      });
      if (existing) {
        console.log('Transaction already exists for email:', input.emailId);
        return {
          id: existing._id.toString(),
          emailId: existing.emailId,
          transactionDate: existing.transactionDate,
          merchant: existing.merchant,
          amount: existing.amount,
          category: existing.category
        };
      }

      const transaction = new Transaction({
        userId: input.userId,
        emailId: input.emailId,
        emailSubject: input.emailSubject,
        emailDate: input.emailDate,
        emailFrom: input.emailFrom,
        rawEmailText: input.rawEmailText,

        transactionDate: input.extractedData.transactionDate,
        merchant: input.extractedData.merchant,
        amount: input.extractedData.amount,
        currency: input.extractedData.currency,
        category: input.extractedData.category,
        transactionType: input.extractedData.transactionType,
        accountNumber: input.extractedData.accountNumber,

        extractedData: input.extractedData.rawResponse,
        confidence: input.extractedData.confidence,

        bankName: input.extractedData.rawResponse.bankName || 'Unknown',

        workflowId: input.workflowId,
        workflowRunId: input.workflowRunId,
        processedAt: new Date()
      });

      await transaction.save();

      console.log(`Transaction saved: ${transaction._id} - ${transaction.merchant} $${transaction.amount}`);

      return {
        id: transaction._id.toString(),
        emailId: transaction.emailId,
        transactionDate: transaction.transactionDate,
        merchant: transaction.merchant,
        amount: transaction.amount,
        category: transaction.category
      };
    },

    /**
     * Match email against known patterns
     */
    async matchEmailPattern(input: MatchEmailPatternInput): Promise<MatchedPattern | null> {
      const patterns = await EmailPattern.find({ isActive: true })
        .sort({ priority: -1 });

      for (const pattern of patterns) {
        // Check from address
        const fromMatch = pattern.fromAddresses.some(addr =>
          input.from.toLowerCase().includes(addr.toLowerCase())
        );

        if (!fromMatch) continue;

        // Check subject patterns
        const subjectMatch = pattern.subjectPatterns.some(regex => {
          try {
            const regExp = new RegExp(regex, 'i');
            return regExp.test(input.subject);
          } catch (error) {
            console.warn(`Invalid regex pattern: ${regex}`);
            return false;
          }
        });

        if (!subjectMatch) continue;

        // Check body keywords (optional)
        if (pattern.bodyKeywords.length > 0) {
          const bodyMatch = pattern.bodyKeywords.some(keyword =>
            input.body.toLowerCase().includes(keyword.toLowerCase())
          );
          if (!bodyMatch) continue;
        }

        // Pattern matched!
        console.log(`Matched pattern: ${pattern.name}`);
        return {
          id: pattern._id.toString(),
          name: pattern.name,
          bankName: pattern.bankName,
          extractionPrompt: pattern.extractionPrompt
        };
      }

      console.log('No matching pattern found for email');
      return null;
    },

    /**
     * Update email pattern statistics
     */
    async updateEmailPatternStats(input: UpdatePatternStatsInput): Promise<void> {
      const pattern = await EmailPattern.findById(input.patternId);
      if (!pattern) {
        console.warn(`Pattern not found: ${input.patternId}`);
        return;
      }

      pattern.matchCount += 1;
      pattern.lastMatchedAt = new Date();

      // Update success rate (simple moving average)
      if (input.success) {
        pattern.successRate = (pattern.successRate * (pattern.matchCount - 1) + 1) / pattern.matchCount;
      } else {
        pattern.successRate = (pattern.successRate * (pattern.matchCount - 1)) / pattern.matchCount;
      }

      await pattern.save();

      console.log(`Updated pattern stats: ${pattern.name} - Success rate: ${(pattern.successRate * 100).toFixed(1)}%`);
    },

    /**
     * Get transactions for a date range
     */
    async getTransactions(startDate: Date, endDate: Date) {
      return await Transaction.find({
        transactionDate: { $gte: startDate, $lte: endDate }
      }).sort({ transactionDate: -1 });
    },

    /**
     * Get all email patterns
     */
    async getEmailPatterns() {
      return await EmailPattern.find().sort({ priority: -1 });
    }
  };
};

export type MongoDBActivities = ReturnType<typeof createMongoDBActivities>;
