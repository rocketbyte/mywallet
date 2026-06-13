#!/usr/bin/env node
/**
 * One-off migration: merge a duplicate user account into a surviving one.
 *
 * Folds the LOSER user's identities, tenant memberships, and tenant-owned data
 * into the SURVIVOR, then deletes the loser's user + tenant. Regenerable data
 * (analyses) and singleton-per-user records (gmail_account, unique on userId)
 * are dropped from the loser rather than moved. Email/transaction/budget rows
 * are reassigned, skipping any that would collide with a survivor row on a
 * unique index.
 *
 * Safe by default: prints a plan and writes a JSON backup. Pass --execute to
 * actually mutate.
 *
 *   MONGODB_URI=... node scripts/merge-duplicate-user.cjs \
 *     --survivor <userId> --loser <userId> [--execute]
 */
const path = require('path');
const fs = require('fs');
const mongoose = require(path.resolve(__dirname, '../node_modules/mongoose'));

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const EXECUTE = process.argv.includes('--execute');
const URI = process.env.MONGODB_URI;
const SURVIVOR = arg('survivor');
const LOSER = arg('loser');

if (!URI) { console.error('Set MONGODB_URI'); process.exit(1); }
if (!SURVIVOR || !LOSER) { console.error('Need --survivor and --loser user ids'); process.exit(1); }
if (SURVIVOR === LOSER) { console.error('survivor and loser are the same'); process.exit(1); }

// Reassign userId (string-scoped data); on unique-key collision, drop the loser row.
const MOVE = ['transactions', 'emails', 'budgets', 'alerts', 'schedule_configs', 'pending_transactions'];
// Regenerable or singleton-per-user — delete the loser's rather than move.
const DROP = ['transaction_analyses', 'monthly_analyses', 'gmail_accounts'];

(async () => {
  await mongoose.connect(URI);
  const db = mongoose.connection.db;
  const oid = (s) => new mongoose.Types.ObjectId(s);

  const survivor = await db.collection('users').findOne({ _id: oid(SURVIVOR) });
  const loser = await db.collection('users').findOne({ _id: oid(LOSER) });
  if (!survivor || !loser) { console.error('survivor or loser user not found'); process.exit(1); }

  const survivorTenant = await db.collection('tenants').findOne({ primaryUserId: oid(SURVIVOR) });
  const loserTenant = await db.collection('tenants').findOne({ primaryUserId: oid(LOSER) });

  console.log(`\nSURVIVOR ${SURVIVOR}  email=${survivor.email}  tenant=${survivorTenant && survivorTenant._id}`);
  console.log(`LOSER    ${LOSER}  email=${loser.email}  tenant=${loserTenant && loserTenant._id}`);
  console.log(`mode: ${EXECUTE ? 'EXECUTE (will mutate)' : 'DRY RUN (no changes)'}\n`);

  if (survivor.email && loser.email && survivor.email.toLowerCase() !== loser.email.toLowerCase()) {
    console.error(`Refusing: emails differ (${survivor.email} vs ${loser.email}).`); process.exit(1);
  }

  // ---- Backup everything we might touch ----
  const backup = { when: new Date().toISOString(), survivor, loser, survivorTenant, loserTenant, data: {} };
  for (const c of [...MOVE, ...DROP]) {
    backup.data[c] = await db.collection(c).find({ userId: LOSER }).toArray();
  }
  backup.memberships = await db.collection('tenant_memberships').find({
    $or: [{ userId: oid(LOSER) }, loserTenant ? { tenantId: loserTenant._id } : { _id: null }],
  }).toArray();
  const backupPath = `/tmp/merge-backup-${LOSER}-${Date.now()}.json`;
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`backup written: ${backupPath}\n`);

  // Unique-key collision detectors for MOVE collections.
  const collides = {
    transactions: (d) => d.emailId != null && db.collection('transactions').findOne({ userId: SURVIVOR, emailId: d.emailId }),
    emails: (d) => db.collection('emails').findOne({ userId: SURVIVOR, emailId: d.emailId }),
    budgets: (d) => db.collection('budgets').findOne({ userId: SURVIVOR, year: d.year, month: d.month }),
    alerts: () => null,
    schedule_configs: () => null,
    pending_transactions: () => null,
  };

  const plan = [];
  for (const c of MOVE) {
    const docs = backup.data[c] || [];
    let move = 0, drop = 0;
    for (const d of docs) {
      const hit = collides[c] ? await collides[c](d) : null;
      if (hit) { drop++; if (EXECUTE) await db.collection(c).deleteOne({ _id: d._id }); }
      else { move++; if (EXECUTE) await db.collection(c).updateOne({ _id: d._id }, { $set: { userId: SURVIVOR } }); }
    }
    plan.push(`MOVE ${c}: reassign ${move}, drop-as-dup ${drop}`);
  }
  for (const c of DROP) {
    const n = (backup.data[c] || []).length;
    if (EXECUTE && n) await db.collection(c).deleteMany({ userId: LOSER });
    plan.push(`DROP ${c}: delete ${n} (loser)`);
  }

  // Memberships: repoint loser's outgoing memberships to the survivor; repoint
  // any membership INTO the loser's tenant to the survivor's tenant. Skip when
  // the (tenantId,userId) pair already exists on the survivor side.
  let mMoved = 0, mDropped = 0;
  for (const ms of backup.memberships) {
    const isOutgoing = String(ms.userId) === LOSER;
    const targetUserId = isOutgoing ? oid(SURVIVOR) : ms.userId;
    const targetTenantId = !isOutgoing && loserTenant && String(ms.tenantId) === String(loserTenant._id) && survivorTenant
      ? survivorTenant._id : ms.tenantId;
    if (String(targetUserId) === String(targetTenantId)) { // safety; shouldn't happen
    }
    const dup = await db.collection('tenant_memberships').findOne({
      _id: { $ne: ms._id }, tenantId: targetTenantId, userId: targetUserId,
    });
    if (dup) { mDropped++; if (EXECUTE) await db.collection('tenant_memberships').deleteOne({ _id: ms._id }); }
    else { mMoved++; if (EXECUTE) await db.collection('tenant_memberships').updateOne({ _id: ms._id }, { $set: { userId: targetUserId, tenantId: targetTenantId } }); }
  }
  plan.push(`MEMBERSHIPS: repoint ${mMoved}, drop-as-dup ${mDropped}`);

  // Delete the loser's tenant + user FIRST — the unique index on
  // (identities.provider, identities.subject) spans all users, so the loser's
  // identity must be gone before we can attach it to the survivor.
  if (EXECUTE && loserTenant) await db.collection('tenants').deleteOne({ _id: loserTenant._id });
  if (EXECUTE) await db.collection('users').deleteOne({ _id: oid(LOSER) });
  plan.push(`DELETE loser tenant ${loserTenant && loserTenant._id} + user ${LOSER}`);

  // Then merge the loser's identities onto the survivor (skip ones it has).
  const have = new Set((survivor.identities || []).map((i) => `${i.provider}:${i.subject}`));
  const toAdd = (loser.identities || []).filter((i) => !have.has(`${i.provider}:${i.subject}`));
  if (EXECUTE && toAdd.length) await db.collection('users').updateOne({ _id: oid(SURVIVOR) }, { $push: { identities: { $each: toAdd } } });
  plan.push(`IDENTITIES: add ${toAdd.length} (${toAdd.map((i) => i.provider + ':' + i.subject.slice(0, 8)).join(', ')})`);

  console.log(plan.map((p) => '  ' + p).join('\n'));
  console.log(EXECUTE ? '\n✅ merge executed.' : '\n(dry run — re-run with --execute to apply)');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
