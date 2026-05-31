import { MonthlyAnalysisContext } from './types';

/**
 * Pure, workflow-safe decision for the monthly-note skip-when-unchanged rule.
 *
 * Kept in its own Node-free module so both `monthlyFinancialNoteWorkflow`
 * (which runs in the Temporal workflow sandbox) and unit tests can import it
 * without pulling in mongoose/crypto from the activities layer.
 *
 * Returns true when a `ready` row already exists for the month and its stored
 * `sourceHash` matches the freshly aggregated one — meaning nothing moved, so
 * the AI call should be skipped (zero tokens).
 */
export function shouldSkipMonthlyNote(
  existing: MonthlyAnalysisContext['existing'],
  freshSourceHash: string
): boolean {
  return existing !== null && existing.status === 'ready' && existing.sourceHash === freshSourceHash;
}
