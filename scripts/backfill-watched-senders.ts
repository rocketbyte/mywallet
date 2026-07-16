/**
 * Backfill sender watchlists from stored extraction history.
 *
 * For every tenant, finds the distinct senders of stored emails that are
 * linked to an extracted transaction (`transactionId` set) and inserts them
 * as `address` entries with `source: 'backfill'`. Existing entries are never
 * modified or removed, and re-running is a no-op (`$setOnInsert` upsert on the
 * unique { userId, value } index) — so existing users see their list
 * pre-populated in the app and ingestion continues seamlessly once the sender
 * gate is live.
 *
 * Usage:
 *   npx tsx scripts/backfill-watched-senders.ts
 *
 * Optional flags:
 *   --dry-run   Print per-user senders that would be inserted without writing.
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { Email, WatchedSender } from '../packages/temporal-workflows/src/models';
import { extractSenderAddress } from '../packages/temporal-workflows/src/shared/sender-match';

const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb://admin:admin123@localhost:27017/mywallet?authSource=admin';

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  await mongoose.connect(MONGODB_URI);
  console.log(`Connected to MongoDB. ${dryRun ? '[DRY RUN]' : ''}`);

  // Distinct raw From headers per user, restricted to emails that actually
  // produced a transaction — the strongest signal a sender is a bank.
  const rows = await Email.aggregate<{ _id: { userId: string; from: string } }>([
    { $match: { transactionId: { $exists: true, $nin: [null, ''] } } },
    { $group: { _id: { userId: '$userId', from: '$from' } } },
  ]);

  // Raw headers vary by display name; collapse them to normalized addresses.
  const byUser = new Map<string, Set<string>>();
  let unparseable = 0;
  for (const row of rows) {
    const address = extractSenderAddress(row._id.from);
    if (!address) {
      unparseable++;
      console.warn(`  ! Unparseable From header for user ${row._id.userId}: "${row._id.from}"`);
      continue;
    }
    if (!byUser.has(row._id.userId)) byUser.set(row._id.userId, new Set());
    byUser.get(row._id.userId)!.add(address);
  }

  let inserted = 0;
  let existing = 0;
  for (const [userId, addresses] of byUser) {
    console.log(`User ${userId}: ${addresses.size} sender(s) — ${[...addresses].join(', ')}`);
    if (dryRun) continue;

    for (const value of addresses) {
      const result = await WatchedSender.updateOne(
        { userId, value },
        { $setOnInsert: { userId, value, kind: 'address', source: 'backfill' } },
        { upsert: true },
      );
      if (result.upsertedCount > 0) inserted++;
      else existing++;
    }
  }

  console.log(
    `Done. Users: ${byUser.size}. ` +
      (dryRun
        ? `Would insert up to ${[...byUser.values()].reduce((s, set) => s + set.size, 0)} entries.`
        : `Inserted: ${inserted}. Already present: ${existing}.`) +
      (unparseable ? ` Unparseable headers: ${unparseable}.` : ''),
  );

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error('Backfill failed:', error);
  process.exitCode = 1;
});
