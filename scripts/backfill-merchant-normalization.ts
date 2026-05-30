/**
 * Backfill merchant normalisation.
 *
 * Rewrites `merchant` on every existing transaction row through
 * `normalizeMerchant`. Idempotent — re-running is a no-op because
 * normalised input maps to itself. Pages by `_id` to stay constant-memory
 * on large collections.
 *
 * Usage:
 *   npx tsx scripts/backfill-merchant-normalization.ts
 *
 * Optional flags:
 *   --dry-run   Show how many rows would change without writing.
 *   --batch=N   Override page size (default 500).
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { Transaction } from '../packages/temporal-workflows/src/models';
import { normalizeMerchant } from '../packages/temporal-workflows/src/shared/normalize-merchant';

const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb://admin:admin123@localhost:27017/mywallet?authSource=admin';

interface CliOpts {
  dryRun: boolean;
  batchSize: number;
}

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = { dryRun: false, batchSize: 500 };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg.startsWith('--batch=')) {
      const n = Number(arg.slice('--batch='.length));
      if (Number.isFinite(n) && n > 0) opts.batchSize = n;
    }
  }
  return opts;
}

async function main() {
  const { dryRun, batchSize } = parseArgs(process.argv);

  await mongoose.connect(MONGODB_URI);
  console.log(`Connected to MongoDB. ${dryRun ? '[DRY RUN] ' : ''}Batch size: ${batchSize}.`);

  let lastId: mongoose.Types.ObjectId | null = null;
  let scanned = 0;
  let changed = 0;

  while (true) {
    const query: Record<string, unknown> = {};
    if (lastId) query._id = { $gt: lastId };

    const batch = await Transaction.find(query)
      .sort({ _id: 1 })
      .limit(batchSize)
      .select({ _id: 1, merchant: 1 })
      .lean();

    if (batch.length === 0) break;

    const writes: mongoose.AnyBulkWriteOperation[] = [];
    for (const row of batch) {
      scanned++;
      const next = normalizeMerchant(row.merchant ?? '');
      if (next && next !== row.merchant) {
        changed++;
        writes.push({
          updateOne: {
            filter: { _id: row._id },
            update: { $set: { merchant: next } },
          },
        });
      }
    }

    if (writes.length && !dryRun) {
      await Transaction.bulkWrite(writes, { ordered: false });
    }

    lastId = batch[batch.length - 1]._id as mongoose.Types.ObjectId;
    console.log(`  scanned=${scanned} changed=${changed} lastId=${lastId}`);
  }

  console.log(`Done. scanned=${scanned} changed=${changed} ${dryRun ? '(no writes)' : ''}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
