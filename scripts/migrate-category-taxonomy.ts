/**
 * One-time migration: relabel stored category strings to the canonical
 * lowercase taxonomy shared with the frontend.
 *
 *   food, groceries, transport, travel, shopping, bills, housing, health,
 *   entertainment, subscriptions, education, personal, income, transfer, other
 *
 * Maps Transaction.category (case-insensitive, legacy/backend labels → canonical)
 * and Budget.categories[].category (services→bills, home→housing). Idempotent:
 * already-canonical values are left unchanged.
 *
 * Usage:
 *   npx tsx scripts/migrate-category-taxonomy.ts --dry   # preview only
 *   npx tsx scripts/migrate-category-taxonomy.ts         # apply
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { Transaction } from '../packages/temporal-workflows/src/models/transaction.model';
import { Budget } from '../packages/temporal-workflows/src/models/budget.model';

const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb://admin:admin123@localhost:27017/mywallet?authSource=admin';

const CANONICAL = new Set([
  'food', 'groceries', 'transport', 'travel', 'shopping', 'bills', 'housing',
  'health', 'entertainment', 'subscriptions', 'education', 'personal',
  'income', 'transfer', 'other',
]);

const ALIASES: Record<string, string> = {
  // legacy client keys
  services: 'bills',
  home: 'housing',
  // backend labels / synonyms (lowercased)
  healthcare: 'health',
  medical: 'health',
  utilities: 'bills',
  'bills & utilities': 'bills',
  rent: 'housing',
  'housing & rent': 'housing',
  'food & dining': 'food',
  dining: 'food',
  grocery: 'groceries',
  subscription: 'subscriptions',
  salary: 'income',
  paycheck: 'income',
  deposit: 'income',
  'personal care': 'personal',
};

/** Pure mapping: any raw category string → canonical key. Unknown → 'other'. */
export function canonicalCategory(raw?: string | null): string {
  if (!raw) return 'other';
  const k = raw.trim().toLowerCase();
  if (CANONICAL.has(k)) return k;
  return ALIASES[k] ?? 'other';
}

async function migrate() {
  const dry = process.argv.includes('--dry');
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log(`Connected.${dry ? ' (dry run — no writes)' : ''}\n`);

  // --- Transactions ---
  const cats: (string | null)[] = await Transaction.distinct('category');
  console.log(`Transaction categories found: ${JSON.stringify(cats)}`);
  let txTouched = 0;
  for (const old of cats) {
    const next = canonicalCategory(old);
    if (next === old) continue;
    const count = await Transaction.countDocuments({ category: old as any });
    console.log(`  ${JSON.stringify(old)} → "${next}" (${count} docs)`);
    if (!dry) {
      const res = await Transaction.updateMany({ category: old as any }, { $set: { category: next } });
      txTouched += res.modifiedCount ?? 0;
    }
  }

  // --- Budgets (nested categories[].category) ---
  // Use a targeted updateOne with $set rather than doc.save() so we don't
  // re-validate unrelated (possibly incomplete) fields on legacy rows.
  const budgets = await Budget.find({}).lean();
  let budgetTouched = 0;
  for (const b of budgets as any[]) {
    const nextCats = (b.categories ?? []).map((c: any) => ({ ...c, category: canonicalCategory(c.category) }));
    const dirty = nextCats.some((c: any, i: number) => c.category !== b.categories[i].category);
    if (!dirty) continue;
    console.log(`  budget ${b._id}: categories → ${nextCats.map((c: any) => c.category).join(', ')}`);
    if (!dry) {
      await Budget.updateOne({ _id: b._id }, { $set: { categories: nextCats } }, { runValidators: false });
      budgetTouched++;
    }
  }

  console.log(`\n${dry ? '[dry] would update' : 'Updated'} transactions: ${dry ? '(see above)' : txTouched}; budgets: ${dry ? '(see above)' : budgetTouched}.`);
  await mongoose.disconnect();
  console.log('Done.');
}

migrate().catch((err) => { console.error('Migration failed:', err); process.exit(1); });
