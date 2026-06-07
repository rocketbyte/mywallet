/**
 * Seed the global daily recurring-transactions Schedule.
 *
 * Registers (or updates) ONE global Temporal Schedule that runs daily and starts
 * `monthlyRecurringTransactionsWorkflow` on the `recurring-queue`. Each run copies
 * the previous month's recurrent transactions whose day-of-month matches that day
 * (resolved at fire time), paging over all tenants — so a single schedule covers
 * everyone (no per-tenant schedules).
 *
 * Overlap policy SKIP: a still-running daily run is never doubled up.
 * Idempotent and safe to run on every boot.
 *
 * Usage:
 *   npx tsx scripts/seed-recurring-schedule.ts [--dry-run]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import {
  Client,
  Connection,
  ScheduleAlreadyRunning,
  ScheduleNotFoundError,
  ScheduleOverlapPolicy,
} from '@temporalio/client';
import { TASK_QUEUES, RECURRING_CONFIG } from '../packages/temporal-workflows/src/shared/constants';

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE || 'default';
const DEFAULT_TZ = process.env.DEFAULT_TENANT_TZ || 'UTC';

const SCHEDULE_ID = 'recurring-transactions-daily';
const WORKFLOW_ID = 'recurring-transactions-daily';

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('Connecting to Temporal at', TEMPORAL_ADDRESS, '...');
  const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
  const client = new Client({ connection, namespace: TEMPORAL_NAMESPACE });
  console.log('Connected.');

  const action = {
    type: 'startWorkflow' as const,
    workflowType: 'monthlyRecurringTransactionsWorkflow',
    workflowId: WORKFLOW_ID,
    taskQueue: TASK_QUEUES.RECURRING,
    args: [] as unknown[],
  };
  const spec = { cronExpressions: [RECURRING_CONFIG.CRON], timezone: DEFAULT_TZ };
  const policies = { overlap: ScheduleOverlapPolicy.SKIP };

  if (dryRun) {
    console.log(`[dry-run] would upsert ${SCHEDULE_ID} (cron='${RECURRING_CONFIG.CRON}', tz=${DEFAULT_TZ})`);
    await connection.close();
    return;
  }

  try {
    const handle = client.schedule.getHandle(SCHEDULE_ID);
    await handle.update(() => ({ action, spec, policies } as any));
    console.log(`✓ updated schedule ${SCHEDULE_ID}`);
  } catch (err: any) {
    const message = err?.message ?? String(err);
    const isNotFound =
      err instanceof ScheduleNotFoundError || message.includes('NotFound') || message.includes('not found');
    if (!isNotFound) throw err;
    try {
      await client.schedule.create({ scheduleId: SCHEDULE_ID, spec, action, policies });
      console.log(`✓ created schedule ${SCHEDULE_ID}`);
    } catch (createErr: any) {
      if (createErr instanceof ScheduleAlreadyRunning) {
        console.log(`= schedule ${SCHEDULE_ID} already exists, skipping`);
      } else {
        throw createErr;
      }
    }
  }

  await connection.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
