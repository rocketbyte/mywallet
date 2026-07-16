/**
 * Unit tests for the pure sender-watchlist helpers (add-sender-watchlist).
 *
 * Run with:
 *   npx tsx --test packages/temporal-workflows/src/shared/__tests__/sender-match.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractSenderAddress,
  normalizeSenderEntry,
  senderMatchesWatchlist,
} from '../sender-match';

test('extractSenderAddress: display-name form, bare form, casing, garbage', () => {
  assert.equal(
    extractSenderAddress('"Banco Popular" <ALERTAS@PopularEnLinea.com>'),
    'alertas@popularenlinea.com',
  );
  assert.equal(extractSenderAddress('alertas@bank.com'), 'alertas@bank.com');
  assert.equal(extractSenderAddress('  Alerts <a@b.co>  '), 'a@b.co');
  assert.equal(extractSenderAddress('not an address'), null);
  assert.equal(extractSenderAddress(''), null);
});

test('normalizeSenderEntry: addresses', () => {
  assert.deepEqual(normalizeSenderEntry(' ALERTAS@Bank.com '), {
    value: 'alertas@bank.com',
    kind: 'address',
  });
  assert.deepEqual(normalizeSenderEntry('Bank <alerts@bank.com>'), {
    value: 'alerts@bank.com',
    kind: 'address',
  });
  // An @-containing value that is not a plausible address is rejected.
  assert.equal(normalizeSenderEntry('foo@bar'), null);
  assert.equal(normalizeSenderEntry('a@b@c.com'), null);
});

test('normalizeSenderEntry: domains', () => {
  assert.deepEqual(normalizeSenderEntry('BancoPopular.com.do'), {
    value: 'bancopopular.com.do',
    kind: 'domain',
  });
  assert.deepEqual(normalizeSenderEntry('@bank.com'), { value: 'bank.com', kind: 'domain' });
  assert.equal(normalizeSenderEntry('not a domain!!'), null);
  assert.equal(normalizeSenderEntry('nodots'), null);
  assert.equal(normalizeSenderEntry(''), null);
});

test('senderMatchesWatchlist: address entries are exact', () => {
  const entries = [{ value: 'alertas@bank.com', kind: 'address' as const }];
  assert.equal(senderMatchesWatchlist('Bank <alertas@bank.com>', entries), true);
  assert.equal(senderMatchesWatchlist('ALERTAS@BANK.COM', entries), true);
  assert.equal(senderMatchesWatchlist('promos@bank.com', entries), false);
});

test('senderMatchesWatchlist: domain entries cover subdomains', () => {
  const entries = [{ value: 'bancopopular.com.do', kind: 'domain' as const }];
  assert.equal(senderMatchesWatchlist('x@bancopopular.com.do', entries), true);
  assert.equal(
    senderMatchesWatchlist('"BP" <no-reply@notificaciones.bancopopular.com.do>', entries),
    true,
  );
  // Suffix must be a dot boundary — evilbancopopular.com.do must NOT match.
  assert.equal(senderMatchesWatchlist('x@evilbancopopular.com.do', entries), false);
  assert.equal(senderMatchesWatchlist('x@bancopopular.com', entries), false);
});

test('senderMatchesWatchlist: empty list and unparseable sender never match', () => {
  assert.equal(senderMatchesWatchlist('x@bank.com', []), false);
  assert.equal(
    senderMatchesWatchlist('garbage header', [{ value: 'bank.com', kind: 'domain' }]),
    false,
  );
});
