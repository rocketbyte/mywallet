/**
 * Tests for verified-email identity linking in MongoUserResolver — prevents
 * one person ending up as two accounts (which silently breaks wallet sharing).
 *
 * Run with:
 *   npx tsx --test packages/backend-apis/src/auth/__tests__/user-resolver-dedup.test.ts
 */
import 'reflect-metadata';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { MongoUserResolver } from '../user.resolver';
import { User } from '../../../../temporal-workflows/src/models';
import type { UserProfile } from '../types';

const resolver = new MongoUserResolver({ ttlMs: 0 }); // no cache between calls

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

const profile = (over: Partial<UserProfile>): UserProfile => ({
  provider: 'firebase',
  subject: 'uid-A',
  email: 'dulce@example.com',
  emailVerified: true,
  ...over,
});

test('first sight creates a new user', async () => {
  const u = await resolver.resolve(profile({ subject: 'uid-A' }));
  assert.ok(u.id);
  assert.equal(await User.countDocuments({}), 1);
});

test('second verified identity for the same email links instead of duplicating', async () => {
  const a = await resolver.resolve(profile({ subject: 'uid-A' }));
  const b = await resolver.resolve(profile({ subject: 'uid-B' }));

  assert.equal(a.id, b.id, 'same internal user returned for both UIDs');
  assert.equal(await User.countDocuments({}), 1, 'no duplicate user created');

  const doc = await User.findById(a.id).lean();
  const subjects = (doc!.identities ?? []).map((i) => i.subject).sort();
  assert.deepEqual(subjects, ['uid-A', 'uid-B'], 'both identities linked');
});

test('a linked UID resolves back to the same user on return', async () => {
  const a = await resolver.resolve(profile({ subject: 'uid-A' }));
  await resolver.resolve(profile({ subject: 'uid-B' }));
  resolver.invalidate('firebase', 'uid-B');

  const again = await resolver.resolve(profile({ subject: 'uid-B' }));
  assert.equal(again.id, a.id);
});

test('email match is case-insensitive', async () => {
  const a = await resolver.resolve(profile({ subject: 'uid-A', email: 'Dulce@Example.com' }));
  const b = await resolver.resolve(profile({ subject: 'uid-B', email: 'dulce@example.com' }));
  assert.equal(a.id, b.id);
  assert.equal(await User.countDocuments({}), 1);
});

test('an UNVERIFIED email does NOT attach to an existing account', async () => {
  const a = await resolver.resolve(profile({ subject: 'uid-A', emailVerified: true }));
  const b = await resolver.resolve(profile({ subject: 'uid-B', emailVerified: false }));

  assert.notEqual(a.id, b.id, 'unverified login gets its own user');
  assert.equal(await User.countDocuments({}), 2);
});

test('different emails never link', async () => {
  const a = await resolver.resolve(profile({ subject: 'uid-A', email: 'a@example.com' }));
  const b = await resolver.resolve(profile({ subject: 'uid-B', email: 'b@example.com' }));
  assert.notEqual(a.id, b.id);
  assert.equal(await User.countDocuments({}), 2);
});
