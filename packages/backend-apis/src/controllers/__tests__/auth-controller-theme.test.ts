/**
 * Tests for the user UI-theme preference on the AuthController:
 * `PATCH /me` validation + persistence, and `GET /me` round-tripping the
 * stored value. Theme follows the user across devices, so it lives on the
 * user record rather than in client storage. An absent preference means light.
 *
 * Run with:
 *   npx tsx --test packages/backend-apis/src/controllers/__tests__/auth-controller-theme.test.ts
 */
import 'reflect-metadata';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { AuthController } from '../auth.controller';
import { User } from '../../../../temporal-workflows/src/models';

// Neither getMe nor updateMe touch the email-provider registry.
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

async function seedUser(fields?: { theme?: string; language?: string }) {
  const doc = await User.create({
    authUid: 'uid-A',
    identities: [{ provider: 'firebase', subject: 'uid-A' }],
    email: 'dulce@example.com',
    emailVerified: true,
    ...(fields ?? {}),
  });
  return String(doc._id);
}

/** Minimal Express req/res doubles that capture status + json. */
function fakeReqRes(userId: string, body?: unknown) {
  const req = { user: { id: userId, provider: 'firebase' }, body } as unknown as Request;
  const captured: { status: number; body: any } = { status: 200, body: undefined };
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(payload: unknown) { captured.body = payload; return this; },
  } as unknown as Response;
  return { req, res, captured };
}

test('GET /me omits theme when the user has never chosen one (light default)', async () => {
  const id = await seedUser();
  const { req, res, captured } = fakeReqRes(id);
  await controller.getMe(req, res);
  assert.equal(captured.status, 200);
  assert.equal(captured.body.user.theme, undefined);
});

test('PATCH /me persists a supported theme and returns the updated user', async () => {
  const id = await seedUser();
  const { req, res, captured } = fakeReqRes(id, { theme: 'dark' });
  await controller.updateMe(req, res);

  assert.equal(captured.status, 200);
  assert.equal(captured.body.user.theme, 'dark');

  const stored = await User.findById(id).lean();
  assert.equal(stored!.theme, 'dark');
});

test('GET /me round-trips a stored theme', async () => {
  const id = await seedUser({ theme: 'dark' });
  const { req, res, captured } = fakeReqRes(id);
  await controller.getMe(req, res);
  assert.equal(captured.body.user.theme, 'dark');
});

test('PATCH /me switches dark back to light', async () => {
  const id = await seedUser({ theme: 'dark' });
  const { req, res, captured } = fakeReqRes(id, { theme: 'light' });
  await controller.updateMe(req, res);

  assert.equal(captured.status, 200);
  assert.equal(captured.body.user.theme, 'light');
  const stored = await User.findById(id).lean();
  assert.equal(stored!.theme, 'light');
});

test('PATCH /me rejects an unsupported theme with 400 and persists nothing', async () => {
  const id = await seedUser({ theme: 'dark' });
  const { req, res, captured } = fakeReqRes(id, { theme: 'solarized' });
  await controller.updateMe(req, res);

  assert.equal(captured.status, 400);
  const stored = await User.findById(id).lean();
  assert.equal(stored!.theme, 'dark', 'rejected update left the prior value intact');
});

test('PATCH /me updates theme without disturbing language, and vice versa', async () => {
  const id = await seedUser({ language: 'es' });

  // Set theme only — language must survive untouched.
  {
    const { req, res, captured } = fakeReqRes(id, { theme: 'dark' });
    await controller.updateMe(req, res);
    assert.equal(captured.status, 200);
    assert.equal(captured.body.user.theme, 'dark');
    assert.equal(captured.body.user.language, 'es');
  }

  // Set language only — theme must survive untouched.
  {
    const { req, res, captured } = fakeReqRes(id, { language: 'en' });
    await controller.updateMe(req, res);
    assert.equal(captured.status, 200);
    assert.equal(captured.body.user.language, 'en');
    assert.equal(captured.body.user.theme, 'dark');
  }
});

test('PATCH /me can set language and theme together', async () => {
  const id = await seedUser();
  const { req, res, captured } = fakeReqRes(id, { language: 'es', theme: 'dark' });
  await controller.updateMe(req, res);

  assert.equal(captured.status, 200);
  assert.equal(captured.body.user.language, 'es');
  assert.equal(captured.body.user.theme, 'dark');
});
