/**
 * Recent-duplicate matching for the transaction pipeline's storeTransaction step.
 *
 * The pipeline drops a new transaction when an existing one for the same tenant
 * shares the exact `amount`, `currency`, and `transactionType` and falls within
 * a tight ±`windowMinutes` window around the new transaction's date — i.e. the
 * same purchase notified twice (a bank's auth then posted email, or one message
 * delivered by both webhook and polling). Merchant is intentionally NOT part of
 * the key: a re-notification can carry slightly different merchant text, which
 * would let a real duplicate slip through.
 *
 * This module is the single source of truth for the window math and match key,
 * shared by the MongoDB and Prisma repositories so the two cannot drift. It is
 * deliberately decorator-free (no DI) so it can be unit-tested directly.
 */
import { RecentDuplicateCriteria } from '../application/interfaces/repositories/transaction-repository.interface';

export interface DuplicateWindow {
  from: Date;
  to: Date;
}

/**
 * Symmetric ±`windowMinutes` window around `near`. Tolerates `near` arriving as
 * an ISO string (Temporal payload serialization may deliver it that way).
 */
export function recentDuplicateWindow(near: Date | string, windowMinutes: number): DuplicateWindow {
  const anchor = near instanceof Date ? near : new Date(near);
  const windowMs = windowMinutes * 60 * 1000;
  return {
    from: new Date(anchor.getTime() - windowMs),
    to: new Date(anchor.getTime() + windowMs),
  };
}

/**
 * The exact MongoDB filter used by `findRecentDuplicate`. Kept here (rather than
 * inline in the decorated repository) so the match semantics are unit-testable
 * without standing up the DI container.
 */
export function buildRecentDuplicateMongoFilter(c: RecentDuplicateCriteria): Record<string, unknown> {
  const { from, to } = recentDuplicateWindow(c.near, c.windowMinutes);
  return {
    userId: c.userId,
    amount: c.amount,
    currency: c.currency,
    transactionType: c.transactionType,
    transactionDate: { $gte: from, $lte: to },
  };
}
