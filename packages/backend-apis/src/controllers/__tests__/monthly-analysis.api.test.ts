/**
 * API/controller + service tests for the monthly note endpoints.
 *
 * Run with:
 *   npx tsx --test packages/backend-apis/src/controllers/__tests__/monthly-analysis.api.test.ts
 *
 * The controller validation paths (400/403) are driven with mock req/res — no
 * Mongo or Temporal needed because validation returns before any service call.
 * The read contract (`getLatest`/`getByMonth`) is covered against
 * mongodb-memory-server through the service layer the endpoints delegate to.
 */
import 'reflect-metadata';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { AnalysisController } from '../analysis.controller';
import { MonthlyAnalysisService } from '../../services/monthly-analysis.service';
import { MonthlyAnalysis } from '../../../../temporal-workflows/src/models';

// --- mock req/res ------------------------------------------------------------
function mockRes() {
  const res: any = { statusCode: 200, body: undefined, ended: false };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

const controller = new AnalysisController();

// ---------------------------------------------------------------------------
// Validation paths (no infra)
// ---------------------------------------------------------------------------

test('getMonthly returns 400 on out-of-range month', async () => {
  const res = mockRes();
  await controller.getMonthly({ query: { year: '2026', month: '13' } } as any, res);
  assert.equal(res.statusCode, 400);
});

test('getMonthly returns 400 on missing params', async () => {
  const res = mockRes();
  await controller.getMonthly({ query: {} } as any, res);
  assert.equal(res.statusCode, 400);
});

test('runMonthly returns 403 for a non-owner', async () => {
  const res = mockRes();
  // id !== dataOwnerId → not the tenant owner
  await controller.runMonthly({ user: { id: 'member-1', dataOwnerId: 'owner-9' }, body: {} } as any, res);
  assert.equal(res.statusCode, 403);
});

test('runMonthly returns 400 for an owner with an out-of-range month', async () => {
  const res = mockRes();
  await controller.runMonthly({ user: { id: 'u1', dataOwnerId: 'u1' }, body: { month: 13 } } as any, res);
  assert.equal(res.statusCode, 400);
});

// ---------------------------------------------------------------------------
// Read contract via the service (mongodb-memory-server)
// ---------------------------------------------------------------------------
let mongod: MongoMemoryServer;
const service = new MonthlyAnalysisService();
const USER = 'user-read';

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await MonthlyAnalysis.deleteMany({});
});

async function seedNote(year: number, month: number, note: string) {
  await MonthlyAnalysis.create({
    userId: USER, year, month, currency: 'USD',
    inputs: { dailyCount: 0, totals: { income: 0, expenses: 0, net: 0 }, balance: 0, budgetSnapshot: null, sourceHash: 'h' },
    note, modelMeta: { model: 'm', promptVersion: 1, tokensIn: 0, tokensOut: 0 }, status: 'ready',
  });
}

test('service.getLatest returns null when the tenant has no note', async () => {
  assert.equal(await service.getLatest(USER), null);
});

test('service.getLatest returns the most-recent (year, month)', async () => {
  await seedNote(2026, 4, 'april');
  await seedNote(2026, 5, 'may');
  await seedNote(2025, 12, 'last december');
  const latest = await service.getLatest(USER);
  assert.equal(latest!.note, 'may');
  assert.equal(latest!.year, 2026);
  assert.equal(latest!.month, 5);
});

test('service.getByMonth returns the requested month or null', async () => {
  await seedNote(2026, 5, 'may');
  const hit = await service.getByMonth(USER, 2026, 5);
  assert.equal(hit!.note, 'may');
  const miss = await service.getByMonth(USER, 2026, 6);
  assert.equal(miss, null);
});

test('service read is scoped to the caller (no cross-tenant leak)', async () => {
  await seedNote(2026, 5, 'mine');
  const other = await service.getByMonth('someone-else', 2026, 5);
  assert.equal(other, null);
});
