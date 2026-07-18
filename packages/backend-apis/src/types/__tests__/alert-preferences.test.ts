/**
 * Unit tests for the alert-preference resolver/validator helpers (no DB).
 *
 * Run with:
 *   npx tsx --test packages/backend-apis/src/types/__tests__/alert-preferences.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveAlertPreferences, parseAlertPreferencesPatch } from '../auth.types';

test('resolveAlertPreferences defaults every key to true when unset', () => {
  assert.deepEqual(resolveAlertPreferences(undefined), {
    overBudget: true, largeTransaction: true, lowBalance: true, weeklySummary: true,
  });
  assert.deepEqual(resolveAlertPreferences(null), {
    overBudget: true, largeTransaction: true, lowBalance: true, weeklySummary: true,
  });
});

test('resolveAlertPreferences reports only explicit false as off', () => {
  assert.deepEqual(resolveAlertPreferences({ overBudget: false }), {
    overBudget: false, largeTransaction: true, lowBalance: true, weeklySummary: true,
  });
});

test('parseAlertPreferencesPatch accepts a partial boolean patch and drops unknown keys', () => {
  const parsed = parseAlertPreferencesPatch({ overBudget: false, bogus: true });
  assert.ok('patch' in parsed);
  assert.deepEqual((parsed as any).patch, { overBudget: false });
});

test('parseAlertPreferencesPatch rejects non-boolean values and non-objects', () => {
  assert.ok('error' in parseAlertPreferencesPatch({ overBudget: 'no' }));
  assert.ok('error' in parseAlertPreferencesPatch([]));
  assert.ok('error' in parseAlertPreferencesPatch('x'));
  assert.ok('error' in parseAlertPreferencesPatch(null));
});
