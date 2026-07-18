/**
 * Service tests for the alerts capability: mark-as-read sets readAt exactly once
 * and is idempotent, and tenant scoping is enforced.
 *
 * Run with:
 *   npx tsx --test packages/backend-apis/src/services/__tests__/alert.service.test.ts
 *
 * Backed by mongodb-memory-server.
 */
import 'reflect-metadata';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { AlertService } from '../alert.service';
import { Alert } from '../../../../temporal-workflows/src/models';

const service = new AlertService();
const USER = 'user-alert';

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
  await Alert.deleteMany({});
});

test('markRead sets read + readAt on first transition, and is idempotent', async () => {
  const created = await service.create(USER, { kind: 'over', title: 'T', body: 'B' });

  const first = await service.markRead(USER, created.id);
  assert.equal(first?.read, true);
  assert.ok(first?.readAt, 'readAt is set on first read');

  const firstReadAt = first!.readAt!;
  // Re-marking returns 200-equivalent (a DTO) without advancing readAt.
  const second = await service.markRead(USER, created.id);
  assert.equal(second?.read, true);
  assert.equal(new Date(second!.readAt!).getTime(), new Date(firstReadAt).getTime());
});

test('markRead does not touch another tenant\'s alert', async () => {
  const created = await service.create(USER, { kind: 'tip', title: 'T', body: 'B' });

  const result = await service.markRead('someone-else', created.id);
  assert.equal(result, null);

  const stored = await Alert.findById(created.id).lean();
  assert.equal(stored?.read, false);
  assert.equal(stored?.readAt, undefined);
});
