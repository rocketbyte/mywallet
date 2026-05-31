/**
 * Seed Analysis Schedules
 *
 * Registers (or updates), per active tenant, the pair of Temporal Schedules
 * that make up financial analysis:
 *   - `dailyTransactionAnalysisWorkflow` at 04:00 (cron `0 4 * * *`)
 *   - `monthlyFinancialNoteWorkflow`     at 04:10 (cron `10 4 * * *`)
 *
 * The monthly note runs 10 minutes after the daily analysis so that day's
 * summary is already written before the monthly rollup reads it. Both are
 * registered together — a tenant never has one without the other. Idempotent,
 * safe to run on every worker boot.
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

interface CliOpts { dryRun: boolean }

function parseArgs(argv: string[]): CliOpts {
  return { dryRun: argv.includes('--dry-run') };
}

type UpsertAction = 'created' | 'updated' | 'skipped' | 'failed';

interface UpsertSpec {
  scheduleId: string;
  workflowType: string;
  workflowId: string;
  cron: string;
  tz: string;
  args: unknown[];
  dryRun: boolean;
}

/** Idempotent update-or-create for one Schedule. */
async function upsertSchedule(client: Client, spec: UpsertSpec): Promise<UpsertAction> {
  if (spec.dryRun) {
    console.log(`[dry-run] would upsert schedule ${spec.scheduleId} (tz=${spec.tz}, cron='${spec.cron}')`);
    return 'skipped';
  }

  const action = {
    type: 'startWorkflow' as const,
    workflowType: spec.workflowType,
    workflowId: spec.workflowId,
    taskQueue: TASK_QUEUES.PIPELINE,
    args: spec.args,
  };

  try {
    const handle = client.schedule.getHandle(spec.scheduleId);
    await handle.update(() => ({ action, spec: { cronExpressions: [spec.cron], timezone: spec.tz } } as any));
    console.log(`✓ updated schedule ${spec.scheduleId}`);
    return 'updated';
  } catch (err: any) {
    const message = err?.message ?? String(err);
    const isNotFound =
      err instanceof ScheduleNotFoundError ||
      message.includes('NotFound') ||
      message.includes('not found');
    if (!isNotFound) {
      console.error(`✗ failed to update ${spec.scheduleId}: ${message}`);
      return 'failed';
    }
    try {
      await client.schedule.create({
        scheduleId: spec.scheduleId,
        spec: { cronExpressions: [spec.cron], timezone: spec.tz },
        action,
      });
      console.log(`✓ created schedule ${spec.scheduleId}`);
      return 'created';
    } catch (createErr: any) {
      if (createErr instanceof ScheduleAlreadyRunning) {
        console.log(`= schedule ${spec.scheduleId} already exists, skipping`);
        return 'skipped';
      }
      console.error(`✗ failed to create ${spec.scheduleId}: ${createErr?.message ?? createErr}`);
      return 'failed';
    }
  }
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

  const tally: Record<UpsertAction, number> = { created: 0, updated: 0, skipped: 0, failed: 0 };

  for (const tenant of tenants) {
    const userId = String(tenant.primaryUserId);
    const tz = DEFAULT_TZ; // Tenant model has no timezone field yet; use env default.
    // No date args — the workflows resolve "yesterday"/"current month" at fire
    // time so each run targets the right window.
    const args = [{ userId }];

    const actions = [
      await upsertSchedule(client, {
        scheduleId: `daily-analysis-${userId}`,
        workflowType: 'dailyTransactionAnalysisWorkflow',
        workflowId: `daily-analysis-wf-${userId}`,
        cron: '0 4 * * *',
        tz,
        args,
        dryRun,
      }),
      await upsertSchedule(client, {
        scheduleId: `monthly-note-${userId}`,
        workflowType: 'monthlyFinancialNoteWorkflow',
        workflowId: `monthly-note-wf-${userId}`,
        cron: '10 4 * * *',
        tz,
        args,
        dryRun,
      }),
    ];
    for (const a of actions) tally[a]++;
  }

  console.log(
    `\nDone. created=${tally.created} updated=${tally.updated} skipped=${tally.skipped} failed=${tally.failed} dryRun=${dryRun}`
  );
  await connection.close();
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
