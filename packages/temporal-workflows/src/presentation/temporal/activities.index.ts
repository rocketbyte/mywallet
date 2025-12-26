/**
 * Activities Index (Layer 3 - Interface Adapters)
 * Central registry for all Temporal activities
 * Wires activities with DI Container
 */
import { DependencyContainer } from 'tsyringe';

// Activity Creators
import { createEmailActivities } from './activities/email.activities';
import { createTransactionActivities } from './activities/transaction.activities';
import { createSyncActivities } from './activities/sync.activities';

/**
 * Create all activities using DI Container
 * Activities are Controllers in Clean Architecture
 *
 * @param container - DI Container with registered dependencies
 * @returns Object containing all activity functions
 */
export function createActivities(container: DependencyContainer) {
  return {
    // Email activities (fetch, match patterns, save, mark processed)
    ...createEmailActivities(container),

    // Transaction activities (extract with AI, save to DB)
    ...createTransactionActivities(container),

    // Sync activities (Gmail sync - placeholder for now)
    ...createSyncActivities(container)
  };
}

/**
 * Activity type definition for Temporal workflows
 * Export for type-safe workflow development
 */
export type Activities = ReturnType<typeof createActivities>;
