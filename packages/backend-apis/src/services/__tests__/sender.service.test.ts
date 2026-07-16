/**
 * Integration tests for the sender-watchlist CRUD (add-sender-watchlist).
 *
 * Run with:
 *   npx tsx --test packages/backend-apis/src/services/__tests__/sender.service.test.ts
 *
 * Backed by mongodb-memory-server.
 */
import 'reflect-metadata';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { SenderService } from '../sender.service';
import { WatchedSender } from '../../../../temporal-workflows/src/models';

const service = new SenderService();
const USER = 'user-senders';
const OTHER_USER = 'user-senders-other';

let mongod: MongoMemoryServer;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await WatchedSender.init();
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await WatchedSender.deleteMany({});
});

test('add normalizes display-name input to a lowercase address entry', async () => {
  const sender = await service.add(USER, 'Alertas <ALERTAS@BancoPopular.com.do>');
  assert.ok(sender);
  assert.equal(sender.value, 'alertas@bancopopular.com.do');
  assert.equal(sender.kind, 'address');
  assert.equal(sender.source, 'manual');
});

test('add stores a domain entry and strips the leading @', async () => {
  const sender = await service.add(USER, '@BancoPopular.com.do', 'onboarding');
  assert.ok(sender);
  assert.equal(sender.value, 'bancopopular.com.do');
  assert.equal(sender.kind, 'domain');
  assert.equal(sender.source, 'onboarding');
});

test('adding a duplicate is idempotent and keeps the original source', async () => {
  const first = await service.add(USER, 'alertas@bank.com', 'onboarding');
  const second = await service.add(USER, ' ALERTAS@bank.com ', 'manual');
  assert.ok(first && second);
  assert.equal(second.id, first.id);
  assert.equal(second.source, 'onboarding');
  assert.equal(await WatchedSender.countDocuments({ userId: USER }), 1);
});

test('add rejects garbage input', async () => {
  assert.equal(await service.add(USER, 'not a sender!!'), null);
  assert.equal(await WatchedSender.countDocuments({}), 0);
});

test('list is tenant-scoped and sorted by value', async () => {
  await service.add(USER, 'z@bank.com');
  await service.add(USER, 'a@bank.com');
  await service.add(OTHER_USER, 'theirs@bank.com');

  const senders = await service.list(USER);
  assert.deepEqual(senders.map((s) => s.value), ['a@bank.com', 'z@bank.com']);
});

test('remove deletes own entries; cross-tenant and malformed ids report not-found', async () => {
  const mine = await service.add(USER, 'mine@bank.com');
  const theirs = await service.add(OTHER_USER, 'theirs@bank.com');
  assert.ok(mine && theirs);

  assert.equal(await service.remove(USER, theirs.id), false, 'cross-tenant delete is invisible');
  assert.equal(await service.remove(USER, 'not-an-objectid'), false, 'malformed id is not-found');
  assert.equal(await service.remove(USER, mine.id), true);
  assert.equal(await WatchedSender.countDocuments({ userId: USER }), 0);
  assert.equal(await WatchedSender.countDocuments({ userId: OTHER_USER }), 1);
});
