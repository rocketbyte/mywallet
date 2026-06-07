/**
 * Recurring-transactions activities (monthly copy job).
 *
 * Pure MongoDB reads/writes — no AI — so they are safe to run with high activity
 * concurrency on the dedicated `recurring-queue`. All writes are idempotent
 * upserts keyed on a deterministic dedup key, so Temporal retries and duplicate
 * schedule fires never create duplicate copies.
 */
import { Types } from 'mongoose';
import { Transaction } from '../../../models/transaction.model';
import { recurringDedupKey, targetDateInMonth } from '../../../shared/recurring';

export interface ListUsersInput {
  /** Inclusive lower bound of the source (previous) month. */
  sourceStart: Date | string;
  /** Exclusive upper bound of the source month. */
  sourceEnd: Date | string;
  /** Cursor: only return users with `userId` greater than this. */
  afterUserId?: string | null;
  limit: number;
}

export interface ListUsersResult {
  userIds: string[];
  /** Last userId of a full page, else null when the scan is exhausted. */
  nextCursor: string | null;
}

export interface CopyPageInput {
  userId: string;
  sourceStart: Date | string;
  sourceEnd: Date | string;
  targetYear: number;
  /** 0-based target month. */
  targetMonth0: number;
  /** `YYYY-MM` of the target month, used in the dedup key. */
  targetYearMonth: string;
  /** Cursor: only copy source rows with `_id` greater than this. */
  afterId?: string | null;
  limit: number;
}

export interface CopyPageResult {
  scanned: number;
  copied: number;
  /** Last source `_id` of a full page, else null when the user's rows are exhausted. */
  nextCursor: string | null;
}

function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

export function createRecurringActivities() {
  return {
    /**
     * One page of distinct userIds that own ≥1 recurrent transaction in the
     * source month, ordered by userId for stable cursor pagination.
     */
    async listUsersWithRecurringTransactions(input: ListUsersInput): Promise<ListUsersResult> {
      const match: Record<string, unknown> = {
        isRecurrent: true,
        transactionDate: { $gte: toDate(input.sourceStart), $lt: toDate(input.sourceEnd) },
      };
      if (input.afterUserId) match.userId = { $gt: input.afterUserId };

      const rows = await Transaction.aggregate<{ _id: string }>([
        { $match: match },
        { $group: { _id: '$userId' } },
        { $sort: { _id: 1 } },
        { $limit: input.limit },
      ]);

      const userIds = rows.map((r) => r._id);
      const nextCursor = userIds.length === input.limit ? userIds[userIds.length - 1] : null;
      return { userIds, nextCursor };
    },

    /**
     * Copies one page of a user's previous-month recurrent transactions into the
     * target month. Idempotent: each copy is upserted on `{ userId, emailId }`
     * with `$setOnInsert`, where `emailId` is the deterministic dedup key, so a
     * re-run inserts nothing and mutates nothing.
     */
    async copyRecurringTransactionsForUserPage(input: CopyPageInput): Promise<CopyPageResult> {
      const query: Record<string, unknown> = {
        userId: input.userId,
        isRecurrent: true,
        transactionDate: { $gte: toDate(input.sourceStart), $lt: toDate(input.sourceEnd) },
      };
      if (input.afterId) query._id = { $gt: new Types.ObjectId(input.afterId) };

      const sources = await Transaction.find(query).sort({ _id: 1 }).limit(input.limit).lean();
      if (sources.length === 0) return { scanned: 0, copied: 0, nextCursor: null };

      const ops = sources.map((src) => {
        const targetDate = targetDateInMonth(
          new Date(src.transactionDate),
          input.targetYear,
          input.targetMonth0,
        );
        const dedupKey = recurringDedupKey(String(src._id), input.targetYearMonth);
        return {
          updateOne: {
            filter: { userId: input.userId, emailId: dedupKey },
            update: {
              $setOnInsert: {
                userId: input.userId,
                emailId: dedupKey,
                transactionDate: targetDate,
                merchant: src.merchant,
                amount: src.amount,
                currency: src.currency,
                category: src.category,
                subcategory: src.subcategory,
                transactionType: src.transactionType,
                note: src.note,
                bankName: src.bankName,
                accountNumber: src.accountNumber,
                isFixedExpense: src.isFixedExpense ?? false,
                isRecurrent: true,
                source: 'recurring' as const,
                processedAt: new Date(),
              },
            },
            upsert: true,
          },
        };
      });

      const result = await Transaction.bulkWrite(ops, { ordered: false });
      const lastId = String(sources[sources.length - 1]._id);
      return {
        scanned: sources.length,
        copied: result.upsertedCount ?? 0,
        nextCursor: sources.length === input.limit ? lastId : null,
      };
    },
  };
}

export type RecurringActivities = ReturnType<typeof createRecurringActivities>;
