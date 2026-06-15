/**
 * Unit tests for the request-hardening helpers: secret redaction (A09) and
 * scalar-parameter coercion that blocks NoSQL operator injection (A03).
 *
 * Run with:
 *   npx tsx --test packages/backend-apis/src/utils/__tests__/security-utils.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { redact } from '../logger';
import { scalarParam } from '../request.utils';

test('redact masks secret-bearing fields case-insensitively', () => {
  const out = redact({
    refreshToken: 'rt-secret',
    Authorization: 'Bearer abc',
    password: 'hunter2',
    merchant: 'Coffee Shop',
  }) as Record<string, unknown>;

  assert.equal(out.refreshToken, '[REDACTED]');
  assert.equal(out.Authorization, '[REDACTED]');
  assert.equal(out.password, '[REDACTED]');
  // Non-secret fields pass through untouched.
  assert.equal(out.merchant, 'Coffee Shop');
});

test('redact recurses into nested objects and arrays', () => {
  const out = redact({
    user: { email: 'a@b.com', idToken: 'tok' },
    items: [{ code: 'oauth-code' }, { amount: 12 }],
  }) as any;

  assert.equal(out.user.email, 'a@b.com');
  assert.equal(out.user.idToken, '[REDACTED]');
  assert.equal(out.items[0].code, '[REDACTED]');
  assert.equal(out.items[1].amount, 12);
});

test('redact handles circular references without throwing', () => {
  const obj: any = { token: 'x' };
  obj.self = obj;
  const out = redact(obj) as any;
  assert.equal(out.token, '[REDACTED]');
  assert.equal(out.self, '[Circular]');
});

test('redact passes through primitives unchanged', () => {
  assert.equal(redact('hello'), 'hello');
  assert.equal(redact(42), 42);
  assert.equal(redact(null), null);
});

test('scalarParam returns strings as-is', () => {
  assert.equal(scalarParam('groceries'), 'groceries');
});

test('scalarParam drops operator-injection objects', () => {
  // Express parses ?category[$ne]=x into an object — must not reach Mongo.
  assert.equal(scalarParam({ $ne: 'groceries' }), undefined);
});

test('scalarParam drops arrays and undefined', () => {
  assert.equal(scalarParam(['a', 'b']), undefined);
  assert.equal(scalarParam(undefined), undefined);
});
