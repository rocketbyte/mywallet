/**
 * Canonical merchant-string normaliser.
 *
 * Used by:
 *   - the AI extraction activity, before handing the payload to storeTransaction
 *   - the transactions API, on POST/PATCH inbound `merchant`
 *   - the one-time backfill script
 *
 * The rule order is load-bearing — change with care, then run the backfill again.
 *
 *   1. Unicode NFC                       — so search/dedup behave consistently
 *   2. Collapse internal whitespace + trim
 *   3. Strip leading/trailing punctuation — keep `McDonald's`, drop `-amazon.`
 *   4. Title Case with preserved acronyms — `NYC` stays `NYC`, not `Nyc`
 *
 * Idempotent: normalizeMerchant(normalizeMerchant(x)) === normalizeMerchant(x).
 */

export const PRESERVED_ACRONYMS: ReadonlySet<string> = new Set([
  'USA', 'NYC', 'LA', 'ATM', 'POS', 'USD', 'EUR', 'DOP',
  'LLC', 'INC', 'CO', 'BBQ', 'DIY', 'IT', 'AI',
]);

const LEADING_PUNCT_RE = /^[\s\p{P}\p{S}]+/u;
const TRAILING_PUNCT_RE = /[\s\p{P}\p{S}]+$/u;
const WHITESPACE_RE = /\s+/g;

export function normalizeMerchant(raw: unknown): string {
  if (typeof raw !== 'string') return '';

  let s = raw.normalize('NFC');
  s = s.replace(WHITESPACE_RE, ' ').trim();
  s = s.replace(LEADING_PUNCT_RE, '').replace(TRAILING_PUNCT_RE, '');
  if (!s) return '';

  return s
    .split(' ')
    .map(titleCaseToken)
    .join(' ');
}

const SUBTOKEN_SPLIT_RE = /([-/])/;

function titleCaseToken(token: string): string {
  if (!token) return token;
  if (PRESERVED_ACRONYMS.has(token.toUpperCase())) return token.toUpperCase();

  // Tokens containing an unspaced ampersand (AT&T, H&M, B&Q, P&G) are
  // almost always acronym clusters — keep them all upper. A `&` surrounded
  // by spaces is a separate token entirely and never lands here.
  if (token.includes('&')) return token.toUpperCase();

  return token
    .split(SUBTOKEN_SPLIT_RE)
    .map((part) => (SUBTOKEN_SPLIT_RE.test(part) ? part : titleCaseSubToken(part)))
    .join('');
}

function titleCaseSubToken(sub: string): string {
  if (!sub) return sub;
  if (PRESERVED_ACRONYMS.has(sub.toUpperCase())) return sub.toUpperCase();

  const chars = [...sub];
  const first = chars[0];
  const rest = chars.slice(1).join('');
  return first.toLocaleUpperCase() + rest.toLocaleLowerCase();
}
