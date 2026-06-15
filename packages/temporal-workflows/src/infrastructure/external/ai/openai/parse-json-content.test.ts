/**
 * Run with:  npx tsx --test packages/temporal-workflows/src/infrastructure/external/ai/openai/parse-json-content.test.ts
 *
 * Guards the pipeline against the failure that surfaced when the LiteLLM
 * router fell back from Cloudflare to Gemini: fallback providers wrap their
 * JSON in ```json … ``` fences (or prose), which a naive JSON.parse rejects.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseJsonContent } from './parse-json-content';

test('parses bare JSON (well-behaved model)', () => {
  assert.deepEqual(parseJsonContent('{"isTransaction":true,"confidence":0.9}'), {
    isTransaction: true,
    confidence: 0.9,
  });
});

test('parses a ```json fenced block (Gemini fallback)', () => {
  const input = '```json\n{"isTransaction":true,"confidence":0.8}\n```';
  assert.deepEqual(parseJsonContent(input), { isTransaction: true, confidence: 0.8 });
});

test('parses a plain ``` fence', () => {
  assert.deepEqual(parseJsonContent('```\n{"isTransaction":false}\n```'), {
    isTransaction: false,
  });
});

test('recovers JSON wrapped in prose', () => {
  const input = 'Here is the classification:\n{"isTransaction":true}\nLet me know!';
  assert.deepEqual(parseJsonContent(input), { isTransaction: true });
});

test('tolerates leading whitespace/newlines', () => {
  assert.deepEqual(parseJsonContent('   \n  {"a":1}'), { a: 1 });
});

test('parses a JSON array', () => {
  assert.deepEqual(parseJsonContent('```json\n[1,2,3]\n```'), [1, 2, 3]);
});

test('throws a clear error when no JSON is present', () => {
  assert.throws(() => parseJsonContent('I could not complete that request.'), /not valid JSON/);
});
