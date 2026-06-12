/**
 * Tests for the wallet-sharing change: TenantMembership semantics (members
 * keep their own wallet), the walletContext middleware (acting context,
 * read-only members, invisibility), and budget value masking.
 *
 * Run with:
 *   npx tsx --test packages/backend-apis/src/services/__tests__/wallet-sharing.test.ts
 */
import 'reflect-metadata';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Request, Response } from 'express';

import { TenantService } from '../tenant.service';
import { walletContext, isBudgetHidden } from '../../auth/wallet-context';
import { maskBudgetForMember } from '../../utils/budget-visibility';
import type { AuthUser } from '../../auth/types';
import type { BudgetDTO } from '../../types/budget.types';
import { Tenant, TenantMembership, User } from '../../../../temporal-workflows/src/models';

const service = new TenantService();

let mongod: MongoMemoryServer;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([Tenant.deleteMany({}), TenantMembership.deleteMany({}), User.deleteMany({})]);
});

async function seedUserWithTenant(email: string, name: string) {
  const user = await User.create({ authUid: `uid-${email}`, email, displayName: name });
  const tenant = await Tenant.create({ primaryUserId: user._id, type: 'individual', name: `${name}'s Wallet` });
  await User.updateOne({ _id: user._id }, { $set: { tenantId: tenant._id } });
  return { user, tenant };
}

// ---------------------------------------------------------------------------
// Membership semantics
// ---------------------------------------------------------------------------

test('addMember creates a membership and never touches the member User.tenantId', async () => {
  const owner = await seedUserWithTenant('owner@x.com', 'Owner');
  const member = await seedUserWithTenant('member@x.com', 'Member');

  const dto = await service.addMember(String(owner.user._id), { email: 'member@x.com' });
  assert.equal(dto.role, 'member');

  const reloaded = await User.findById(member.user._id).lean();
  assert.equal(String(reloaded!.tenantId), String(member.tenant._id), 'member keeps their own wallet');

  const membership = await TenantMembership.findOne({ tenantId: owner.tenant._id, userId: member.user._id }).lean();
  assert.ok(membership, 'membership row exists');
  assert.equal(membership!.status, 'active');
});

test('addMember is idempotent and rejects the owner themselves', async () => {
  const owner = await seedUserWithTenant('owner@x.com', 'Owner');
  await seedUserWithTenant('member@x.com', 'Member');

  await service.addMember(String(owner.user._id), { email: 'member@x.com' });
  await service.addMember(String(owner.user._id), { email: 'member@x.com' });
  assert.equal(await TenantMembership.countDocuments({}), 1, 're-add is a no-op');

  await assert.rejects(() => service.addMember(String(owner.user._id), { email: 'owner@x.com' }));
});

test('removeMember deletes only the membership; the member wallet survives', async () => {
  const owner = await seedUserWithTenant('owner@x.com', 'Owner');
  const member = await seedUserWithTenant('member@x.com', 'Member');
  await service.addMember(String(owner.user._id), { email: 'member@x.com' });

  await service.removeMember(String(owner.user._id), String(member.user._id));

  assert.equal(await TenantMembership.countDocuments({}), 0);
  const reloaded = await User.findById(member.user._id).lean();
  assert.equal(String(reloaded!.tenantId), String(member.tenant._id), 'member wallet intact');
});

test('listWalletsForUser returns own wallet first, then memberships', async () => {
  const owner = await seedUserWithTenant('owner@x.com', 'Owner');
  const member = await seedUserWithTenant('member@x.com', 'Member');
  await Tenant.updateOne({ _id: owner.tenant._id }, { $set: { showBudgetToMembers: false } });
  await service.addMember(String(owner.user._id), { email: 'member@x.com' });

  const wallets = await service.listWalletsForUser(String(member.user._id));
  assert.equal(wallets.length, 2);
  assert.equal(wallets[0].role, 'owner');
  assert.equal(wallets[0].id, String(member.tenant._id));
  assert.equal(wallets[1].role, 'member');
  assert.equal(wallets[1].id, String(owner.tenant._id));
  assert.equal(wallets[1].budgetHidden, true);
  assert.equal(wallets[1].ownerName, 'Owner');
});

// ---------------------------------------------------------------------------
// walletContext middleware
// ---------------------------------------------------------------------------

function fakeReqRes(user: AuthUser, opts: { header?: string; method?: string } = {}) {
  let statusCode = 0;
  let body: unknown;
  const req = {
    user,
    method: opts.method ?? 'GET',
    header: (name: string) => (name.toLowerCase() === 'x-wallet-id' ? opts.header : undefined),
  } as unknown as Request;
  const res = {
    status(code: number) { statusCode = code; return this; },
    json(payload: unknown) { body = payload; return this; },
  } as unknown as Response;
  return { req, res, result: () => ({ statusCode, body }) };
}

function authUserFor(userId: string, tenantId: string): AuthUser {
  return { id: userId, authUid: 'uid', provider: 'test', tenantId, dataOwnerId: userId };
}

test('walletContext: no header keeps owner context', async () => {
  const owner = await seedUserWithTenant('owner@x.com', 'Owner');
  const user = authUserFor(String(owner.user._id), String(owner.tenant._id));
  const { req, res } = fakeReqRes(user);

  let nexted = false;
  await walletContext(req, res, () => { nexted = true; });

  assert.ok(nexted);
  assert.equal(req.walletRole, 'owner');
  assert.equal(req.user!.dataOwnerId, String(owner.user._id));
});

test('walletContext: member header scopes data owner without mutating the cached user', async () => {
  const owner = await seedUserWithTenant('owner@x.com', 'Owner');
  const member = await seedUserWithTenant('member@x.com', 'Member');
  await service.addMember(String(owner.user._id), { email: 'member@x.com' });

  const cached = authUserFor(String(member.user._id), String(member.tenant._id));
  const { req, res } = fakeReqRes(cached, { header: String(owner.tenant._id) });

  let nexted = false;
  await walletContext(req, res, () => { nexted = true; });

  assert.ok(nexted);
  assert.equal(req.walletRole, 'member');
  assert.equal(req.user!.dataOwnerId, String(owner.user._id), 'request scoped to the shared wallet');
  assert.equal(cached.dataOwnerId, String(member.user._id), 'cached AuthUser untouched');
});

test('walletContext: mutating verbs are rejected in member context', async () => {
  const owner = await seedUserWithTenant('owner@x.com', 'Owner');
  const member = await seedUserWithTenant('member@x.com', 'Member');
  await service.addMember(String(owner.user._id), { email: 'member@x.com' });

  const user = authUserFor(String(member.user._id), String(member.tenant._id));
  const { req, res, result } = fakeReqRes(user, { header: String(owner.tenant._id), method: 'DELETE' });

  await walletContext(req, res, () => { assert.fail('next() must not run'); });

  assert.equal(result().statusCode, 403);
  assert.equal((result().body as { error: string }).error, 'READ_ONLY_MEMBER');
});

test('walletContext: non-members and malformed ids get 404', async () => {
  const owner = await seedUserWithTenant('owner@x.com', 'Owner');
  const stranger = await seedUserWithTenant('stranger@x.com', 'Stranger');

  const user = authUserFor(String(stranger.user._id), String(stranger.tenant._id));
  for (const header of [String(owner.tenant._id), 'not-an-object-id']) {
    const { req, res, result } = fakeReqRes(user, { header });
    await walletContext(req, res, () => { assert.fail('next() must not run'); });
    assert.equal(result().statusCode, 404);
    assert.equal((result().body as { error: string }).error, 'WALLET_NOT_FOUND');
  }
});

test('walletContext: hidden-budget flag reaches isBudgetHidden', async () => {
  const owner = await seedUserWithTenant('owner@x.com', 'Owner');
  const member = await seedUserWithTenant('member@x.com', 'Member');
  await Tenant.updateOne({ _id: owner.tenant._id }, { $set: { showBudgetToMembers: false } });
  await service.addMember(String(owner.user._id), { email: 'member@x.com' });

  const user = authUserFor(String(member.user._id), String(member.tenant._id));
  const { req, res } = fakeReqRes(user, { header: String(owner.tenant._id) });
  await walletContext(req, res, () => {});

  assert.equal(isBudgetHidden(req), true);
});

// ---------------------------------------------------------------------------
// Budget masking
// ---------------------------------------------------------------------------

test('maskBudgetForMember nulls budget-derived values and adds progress', () => {
  const dto: BudgetDTO = {
    id: 'b1', userId: 'u1', year: 2026, month: 6,
    periodStart: '2026-06-01', periodEnd: '2026-06-30',
    isCarriedForward: false,
    totalBudget: 1000, totalSpent: 400, balance: 600, limitAmount: 1000,
    locked: false,
    categories: [
      { category: 'Food', budget: 200, spent: 50, transactionCount: 3 },
      { category: 'Transport', budget: 0, spent: 10, transactionCount: 1 },
    ],
  };

  const masked = maskBudgetForMember(dto);

  assert.equal(masked.totalBudget, null);
  assert.equal(masked.limitAmount, null);
  assert.equal(masked.balance, null);
  assert.equal(masked.budgetHidden, true);
  assert.equal(masked.progressPercent, 40);
  assert.equal(masked.totalSpent, 400, 'spent stays visible');
  assert.equal(masked.categories[0].budget, null);
  assert.equal(masked.categories[0].progressPercent, 25);
  assert.equal(masked.categories[0].spent, 50);
  assert.equal(masked.categories[1].progressPercent, 0, 'zero budget guarded');
});
