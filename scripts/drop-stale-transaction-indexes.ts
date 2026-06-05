/**
 * Drop stale indexes on the `transactions` collection.
 *
 * An older schema declared a single-field unique index on `emailId`
 * (`emailId_1`). The current model replaced it with a sparse compound unique
 * index `{ userId, emailId }`, but Mongoose only *creates* missing indexes — it
 * never drops extras. The leftover non-sparse `emailId_1` indexes a missing
 * `emailId` as `null`, so the second manually-entered transaction (which has no
 * emailId) fails with `E11000 dup key { emailId: null }`.
 *
 * This script drops `emailId_1` if present, then reconciles the collection's
 * indexes with the model via `syncIndexes()` so the deployed indexes match the
 * schema exactly. Idempotent — re-running is a no-op.
 *
 * Usage:
 *   npx tsx scripts/drop-stale-transaction-indexes.ts
 *
 * Optional flags:
 *   --dry-run   List indexes and report what would change without writing.
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { Transaction } from '../packages/temporal-workflows/src/models';

const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb://admin:admin123@localhost:27017/mywallet?authSource=admin';

const STALE_INDEXES = ['emailId_1'];

async function main() {
  const dryRun = process.argv.slice(2).includes('--dry-run');

  // Disable autoIndex so this maintenance connection doesn't kick off background
  // index builds that race with our dropIndex/syncIndexes calls
  // (BackgroundOperationInProgressForNamespace).
  await mongoose.connect(MONGODB_URI, { autoIndex: false });
  const collection = Transaction.collection;

  const before = await collection.indexes();
  console.log('Current indexes:');
  for (const idx of before) console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);

  for (const name of STALE_INDEXES) {
    const exists = before.some((i) => i.name === name);
    if (!exists) {
      console.log(`\n${name}: not present — nothing to drop.`);
      continue;
    }
    if (dryRun) {
      console.log(`\n[dry-run] would drop index "${name}".`);
      continue;
    }
    await collection.dropIndex(name);
    console.log(`\nDropped index "${name}".`);
  }

  if (dryRun) {
    console.log('\n[dry-run] would run Transaction.syncIndexes() to reconcile remaining indexes.');
  } else {
    const dropped = await Transaction.syncIndexes();
    console.log(`\nsyncIndexes complete. Reconciled (dropped extras): ${JSON.stringify(dropped)}`);
    const after = await collection.indexes();
    console.log('Indexes now:');
    for (const idx of after) console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Failed to drop stale transaction indexes:', err);
  process.exit(1);
});
