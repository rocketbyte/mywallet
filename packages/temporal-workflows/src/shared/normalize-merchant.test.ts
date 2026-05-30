/**
 * Run with:  npx tsx --test packages/temporal-workflows/src/shared/normalize-merchant.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeMerchant } from './normalize-merchant';

test('all-caps input gets Title Cased', () => {
  assert.equal(normalizeMerchant('AMAZON MARKETPLACE'), 'Amazon Marketplace');
});

test('mixed case is normalised', () => {
  assert.equal(normalizeMerchant('aMaZoN mArKeTpLaCe'), 'Amazon Marketplace');
});

test('runs of internal whitespace collapse to one space', () => {
  assert.equal(normalizeMerchant('Amazon    Marketplace'), 'Amazon Marketplace');
});

test('leading and trailing whitespace is trimmed', () => {
  assert.equal(normalizeMerchant('   Amazon Marketplace   '), 'Amazon Marketplace');
});

test('leading and trailing punctuation is stripped', () => {
  assert.equal(normalizeMerchant('-amazon marketplace.'), 'Amazon Marketplace');
  assert.equal(normalizeMerchant('***  STARBUCKS  ***'), 'Starbucks');
});

test('mid-token apostrophes and ampersands are preserved', () => {
  assert.equal(normalizeMerchant("MCDONALD'S"), "Mcdonald's");
  assert.equal(normalizeMerchant('AT&T STORE'), 'AT&T Store');
});

test('accented characters are NFC-normalised', () => {
  const decomposed = 'CAFÉ BUSTELO';
  const out = normalizeMerchant(decomposed);
  assert.equal(out, 'Café Bustelo');
  assert.equal(out.normalize('NFC'), out);
});

test('preserved acronyms keep their casing', () => {
  assert.equal(normalizeMerchant('NYC TAXI'), 'NYC Taxi');
  assert.equal(normalizeMerchant('usa atm fee'), 'USA ATM Fee');
  assert.equal(normalizeMerchant('USD wire'), 'USD Wire');
});

test('non-acronym tokens never get upper-cased by accident', () => {
  assert.equal(normalizeMerchant('NEW YORK'), 'New York');
  assert.equal(normalizeMerchant('LONDON'), 'London');
});

test('hyphenated tokens are title-cased per segment', () => {
  assert.equal(normalizeMerchant('WAL-MART'), 'Wal-Mart');
});

test('idempotent: f(f(x)) === f(x)', () => {
  const inputs = [
    'AMAZON MARKETPLACE',
    '-amazon marketplace.',
    'NYC TAXI & LIMOUSINE',
    'CAFÉ BUSTELO',
    'aMaZoN',
    '   spaced   out   ',
  ];
  for (const raw of inputs) {
    const once = normalizeMerchant(raw);
    const twice = normalizeMerchant(once);
    assert.equal(twice, once, `not idempotent for "${raw}"`);
  }
});

test('empty / non-string input returns empty string', () => {
  assert.equal(normalizeMerchant(''), '');
  assert.equal(normalizeMerchant('   '), '');
  assert.equal(normalizeMerchant('---'), '');
  assert.equal(normalizeMerchant(undefined), '');
  assert.equal(normalizeMerchant(null), '');
  assert.equal(normalizeMerchant(42 as unknown), '');
});
