/**
 * Unit tests for localized alert copy (no DB).
 *
 * Run with:
 *   npx tsx --test packages/temporal-workflows/src/shared/__tests__/alert-i18n.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { overBudgetAlertCopy, resolveLanguage } from '../alert-i18n';

test('resolveLanguage defaults everything except es to en', () => {
  assert.equal(resolveLanguage('es'), 'es');
  assert.equal(resolveLanguage('en'), 'en');
  assert.equal(resolveLanguage(undefined), 'en');
  assert.equal(resolveLanguage('fr'), 'en');
});

test('English over-budget copy uses the display label and amounts', () => {
  const { title, body } = overBudgetAlertCopy('en', {
    category: 'shopping', spent: 530, limit: 500, percentage: 106, currency: 'USD',
  });
  assert.equal(title, 'Shopping budget exceeded');
  assert.equal(body, "You've spent $530.00 of your $500.00 Shopping budget this month (106%).");
});

test('Spanish over-budget copy is translated, including the category name', () => {
  const { title, body } = overBudgetAlertCopy('es', {
    category: 'shopping', spent: 530, limit: 500, percentage: 106, currency: 'USD',
  });
  assert.equal(title, 'Presupuesto de Compras excedido');
  assert.equal(body, 'Has gastado $530.00 de tu presupuesto de $500.00 para Compras este mes (106%).');
});

test('category label lookup is case-insensitive (stored "Other")', () => {
  assert.match(overBudgetAlertCopy('es', {
    category: 'Other', spent: 10, limit: 5, percentage: 200,
  }).title, /Otros/);
});
