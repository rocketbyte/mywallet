/**
 * Pure sender-watchlist helpers — no I/O, so they are safe inside deterministic
 * Temporal workflow code and trivially unit-testable. Shared by the
 * email-processing workflow gate, the senders REST API validation, and the
 * backfill script.
 */

export type SenderEntryKind = 'address' | 'domain';

export interface SenderEntry {
  value: string;
  kind: SenderEntryKind;
}

// Deliberately loose shape checks: the goal is to reject obvious garbage while
// accepting every real-world bank sender, not to fully validate RFC 5322.
const ADDRESS_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const DOMAIN_RE = /^[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * Extracts the bare email address from a `From:` header value, e.g.
 * `"Banco Popular" <alertas@popularenlinea.com>` → `alertas@popularenlinea.com`.
 * Falls back to the trimmed, lowercased input when no angle-bracket form is
 * present. Returns null for input with no plausible address.
 */
export function extractSenderAddress(fromHeader: string): string | null {
  if (!fromHeader) return null;
  const angled = /<([^<>]+)>/.exec(fromHeader);
  const candidate = (angled ? angled[1] : fromHeader).trim().toLowerCase();
  return ADDRESS_RE.test(candidate) ? candidate : null;
}

/**
 * Normalizes raw user/backfill input into a watchlist entry: trims, lowercases,
 * reduces display-name forms to the bare address, and strips a leading `@`
 * from domain input. Returns null when the input is neither a plausible email
 * address nor a plausible domain.
 */
export function normalizeSenderEntry(input: string): SenderEntry | null {
  if (!input) return null;
  let value = input.trim().toLowerCase();

  const angled = /<([^<>]+)>/.exec(value);
  if (angled) value = angled[1].trim();
  if (value.startsWith('@')) value = value.slice(1);

  if (value.includes('@')) {
    return ADDRESS_RE.test(value) ? { value, kind: 'address' } : null;
  }
  return DOMAIN_RE.test(value) ? { value, kind: 'domain' } : null;
}

/**
 * True when the sender of `fromHeader` matches any watchlist entry:
 * - `address` entries match the extracted address exactly;
 * - `domain` entries match addresses at the domain or any of its subdomains.
 * An unparseable sender or an empty watchlist never matches.
 */
export function senderMatchesWatchlist(
  fromHeader: string,
  entries: ReadonlyArray<SenderEntry>,
): boolean {
  if (entries.length === 0) return false;
  const address = extractSenderAddress(fromHeader);
  if (!address) return false;
  const domain = address.slice(address.indexOf('@') + 1);

  return entries.some((entry) =>
    entry.kind === 'address'
      ? entry.value === address
      : domain === entry.value || domain.endsWith(`.${entry.value}`),
  );
}
