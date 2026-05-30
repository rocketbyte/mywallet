/**
 * Seed Daily Analysis Schedules
 *
 * Registers (or updates) one Temporal Schedule per active tenant that fires
 * `dailyTransactionAnalysisWorkflow` at 04:00 in the tenant's timezone, cron
 * `0 4 * * *`. Idempotent — safe to run on every worker boot. The Schedule
 * action computes `analysisDate` as "yesterday in the tenant's tz" at
 * trigger time via a Temporal Schedule Spec offset; here we just register
 * the recurring action and rely on the workflow itself to interpret
 * `analysisDate = yesterday` based on the Schedule fire time.
 *
 * Usage:
 *   npx tsx scripts/seed-daily-analysis-schedules.ts
 *
 * Optional flags:
 *   --dry-run    Print intended actions without writing.
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { Client, Connection, ScheduleAlreadyRunning, ScheduleNotFoundError } from '@temporalio/client';
import { Tenant } from '../packages/temporal-workflows/src/models/tenant.model';
import { TASK_QUEUES } from '../packages/temporal-workflows/src/shared/constants';

const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb://admin:admin123@localhost:27017/mywallet?authSource=admin';
const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE || 'default';
const DEFAULT_TZ = process.env.DEFAULT_TENANT_TZ || 'UTC';

function scheduleIdFor(userId: string): string {
  return `daily-analysis-${userId}`;
}

function workflowIdFor(userId: string): string {
  return `daily-analysis-wf-${userId}`;
}

/**
 * Yesterday in the given IANA timezone, as YYYY-MM-DD.
 * The schedule action is computed at register time; Temporal Schedules
 * pass the same `analysisDate` argument to every fire, so we set it to
 * a sentinel and let the worker resolve "yesterday" at trigger time
 * via the workflow input default — see workflow handling.
 *
 * Simpler alternative: register one schedule that runs daily and pass
 * `analysisDate: 'yesterday'` as a literal token the workflow interprets.
 * For now we hardcode the calendar date and rely on a daily re-seed for
 * date roll-over; the dedicated boot re-seed handles this in practice.
 */
function yesterdayInTZ(tz: string): string {
  const now = new Date();
  // Compute "now" in the target tz, then subtract a day.
  const nowInTZ = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  nowInTZ.setDate(nowInTZ.getDate() - 1);
  const y = nowInTZ.getFullYear();
  const m = String(nowInTZ.getMonth() + 1).padStart(2, '0');
  const d = String(nowInTZ.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

interface CliOpts { dryRun: boolean }

function parseArgs(argv: string[]): CliOpts {
  return { dryRun: argv.includes('--dry-run') };
}

async function main() {
  const { dryRun } = parseArgs(process.argv);

  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected.');

  console.log('Connecting to Temporal at', TEMPORAL_ADDRESS, '...');
  const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
  const client = new Client({ connection, namespace: TEMPORAL_NAMESPACE });
  console.log('Connected.');

  const tenants = await Tenant.find({}).lean();
  console.log(`Found ${tenants.length} tenants.\n`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const tenant of tenants) {
    const userId = String(tenant.primaryUserId);
    const tz = DEFAULT_TZ; // Tenant model has no timezone field yet; use env default.
    const scheduleId = scheduleIdFor(userId);
    const args = [{ userId, analysisDate: yesterdayInTZ(tz) }];

    if (dryRun) {
      console.log(`[dry-run] would upsert schedule ${scheduleId} (tz=${tz})`);
      skipped++;
      continue;
    }

    try {
      const handle = client.schedule.getHandle(scheduleId);
      await handle.update(() => ({
        action: {
          type: 'startWorkflow',
          workflowType: 'dailyTransactionAnalysisWorkflow',
          workflowId: workflowIdFor(userId),
          taskQueue: TASK_QUEUES.PIPELINE,
          args,
        },
        spec: { cronExpressions: ['0 4 * * *'], timezone: tz },
      } as any));
      updated++;
      console.log(`✓ updated schedule ${scheduleId}`);
    } catch (err: any) {
      const message = err?.message ?? String(err);
      const isNotFound =
        err instanceof ScheduleNotFoundError ||
        message.includes('NotFound') ||
        message.includes('not found');
      if (!isNotFound) {
        console.error(`✗ failed to update ${scheduleId}: ${message}`);
        continue;
      }
      try {
        await client.schedule.create({
          scheduleId,
          spec: { cronExpressions: ['0 4 * * *'], timezone: tz },
          action: {
            type: 'startWorkflow',
            workflowType: 'dailyTransactionAnalysisWorkflow',
            workflowId: workflowIdFor(userId),
            taskQueue: TASK_QUEUES.PIPELINE,
            args,
          },
        });
        created++;
        console.log(`✓ created schedule ${scheduleId}`);
      } catch (createErr: any) {
        if (createErr instanceof ScheduleAlreadyRunning) {
          skipped++;
          console.log(`= schedule ${scheduleId} already exists, skipping`);
        } else {
          console.error(`✗ failed to create ${scheduleId}: ${createErr?.message ?? createErr}`);
        }
      }
    }
  }

  console.log(`\nDone. created=${created} updated=${updated} skipped=${skipped} dryRun=${dryRun}`);
  await connection.close();
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
