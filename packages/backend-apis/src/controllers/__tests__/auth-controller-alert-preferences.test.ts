/**
 * Tests for per-account alert preferences on the AuthController:
 * `GET /me` resolves defaults (all on), `PATCH /me` merges a partial patch and
 * validates booleans. Preferences follow the account, so they live on the user
 * record. An unset key means the alert is enabled (the switches default on).
 *
 * Run with:
 *   npx tsx --test packages/backend-apis/src/controllers/__tests__/auth-controller-alert-preferences.test.ts
 */
import 'reflect-metadata';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { AuthController } from '../auth.controller';
import { User } from '../../../../temporal-workflows/src/models';

const controller = new AuthController({} as never);

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
  await User.deleteMany({});
});

async function seedUser(fields?: Record<string, unknown>) {
  const doc = await User.create({
    authUid: 'uid-A',
    identities: [{ provider: 'firebase', subject: 'uid-A' }],
    email: 'dulce@example.com',
    emailVerified: true,
    ...(fields ?? {}),
  });
  return String(doc._id);
}

function fakeReqRes(userId: string, body?: unknown) {
  const req = { user: { id: userId, provider: 'firebase' }, body } as unknown as Request;
  const captured: { status: number; body: any } = { status: 200, body: undefined };
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(payload: unknown) { captured.body = payload; return this; },
  } as unknown as Response;
  return { req, res, captured };
}

const ALL_ON = { overBudget: true, largeTransaction: true, lowBalance: true, weeklySummary: true };

test('GET /me resolves all preferences on when never set', async () => {
  const id = await seedUser();
  const { req, res, captured } = fakeReqRes(id);
  await controller.getMe(req, res);
  assert.equal(captured.status, 200);
  assert.deepEqual(captured.body.user.alertPreferences, ALL_ON);
});

test('PATCH /me merges a partial patch, leaving other keys on', async () => {
  const id = await seedUser();
  const { req, res, captured } = fakeReqRes(id, { alertPreferences: { overBudget: false } });
  await controller.updateMe(req, res);

  assert.equal(captured.status, 200);
  assert.deepEqual(captured.body.user.alertPreferences, {
    overBudget: false, largeTransaction: true, lowBalance: true, weeklySummary: true,
  });

  const stored = await User.findById(id).lean();
  assert.equal(stored!.alertPreferences!.overBudget, false);
});

test('PATCH /me merges successive patches without clobbering earlier keys', async () => {
  const id = await seedUser();

  await controller.updateMe(...twoArgs(fakeReqRes(id, { alertPreferences: { overBudget: false } })));
  const { req, res, captured } = fakeReqRes(id, { alertPreferences: { weeklySummary: false } });
  await controller.updateMe(req, res);

  assert.deepEqual(captured.body.user.alertPreferences, {
    overBudget: false, largeTransaction: true, lowBalance: true, weeklySummary: false,
  });
});

test('PATCH /me rejects a non-boolean preference with 400 and persists nothing', async () => {
  const id = await seedUser({ alertPreferences: { overBudget: false } });
  const { req, res, captured } = fakeReqRes(id, { alertPreferences: { overBudget: 'nope' } });
  await controller.updateMe(req, res);

  assert.equal(captured.status, 400);
  const stored = await User.findById(id).lean();
  assert.equal(stored!.alertPreferences!.overBudget, false, 'rejected update left the prior value intact');
});

test('PATCH /me updates alertPreferences without disturbing theme', async () => {
  const id = await seedUser({ theme: 'dark' });
  const { req, res, captured } = fakeReqRes(id, { alertPreferences: { lowBalance: false } });
  await controller.updateMe(req, res);

  assert.equal(captured.body.user.theme, 'dark');
  assert.equal(captured.body.user.alertPreferences.lowBalance, false);
});

/** Helper to spread a fakeReqRes into updateMe's (req, res) args. */
function twoArgs(x: { req: Request; res: Response }): [Request, Response] {
  return [x.req, x.res];
}
