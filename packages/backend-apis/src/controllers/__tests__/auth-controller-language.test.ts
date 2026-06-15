/**
 * Tests for the user UI-language preference on the AuthController:
 * `PATCH /me` validation + persistence, and `GET /me` round-tripping the
 * stored value. Language follows the user across devices, so it lives on the
 * user record rather than in client storage.
 *
 * Run with:
 *   npx tsx --test packages/backend-apis/src/controllers/__tests__/auth-controller-language.test.ts
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

async function seedUser(language?: string) {
  const doc = await User.create({
    authUid: 'uid-A',
    identities: [{ provider: 'firebase', subject: 'uid-A' }],
    email: 'dulce@example.com',
    emailVerified: true,
    ...(language ? { language } : {}),
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

test('GET /me omits language when the user has never chosen one', async () => {
  const id = await seedUser();
  const { req, res, captured } = fakeReqRes(id);
  await controller.getMe(req, res);
  assert.equal(captured.status, 200);
  assert.equal(captured.body.user.language, undefined);
});

test('PATCH /me persists a supported language and returns the updated user', async () => {
  const id = await seedUser();
  const { req, res, captured } = fakeReqRes(id, { language: 'es' });
  await controller.updateMe(req, res);

  assert.equal(captured.status, 200);
  assert.equal(captured.body.user.language, 'es');

  const stored = await User.findById(id).lean();
  assert.equal(stored!.language, 'es');
});

test('GET /me round-trips a stored language', async () => {
  const id = await seedUser('es');
  const { req, res, captured } = fakeReqRes(id);
  await controller.getMe(req, res);
  assert.equal(captured.body.user.language, 'es');
});

test('PATCH /me rejects an unsupported language with 400 and persists nothing', async () => {
  const id = await seedUser('en');
  const { req, res, captured } = fakeReqRes(id, { language: 'fr' });
  await controller.updateMe(req, res);

  assert.equal(captured.status, 400);
  const stored = await User.findById(id).lean();
  assert.equal(stored!.language, 'en', 'rejected update left the prior value intact');
});

test('PATCH /me with no language field is a 400', async () => {
  const id = await seedUser();
  const { req, res, captured } = fakeReqRes(id, {});
  await controller.updateMe(req, res);
  assert.equal(captured.status, 400);
});
