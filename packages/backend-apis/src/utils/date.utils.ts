export function padTwo(n: number): string {
  return n.toString().padStart(2, '0');
}

export function formatWhen(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

export function periodStart(month: number, year: number): string {
  return `${year}-${padTwo(month)}-01`;
}

export function periodEnd(month: number, year: number): string {
  return `${year}-${padTwo(month)}-${padTwo(new Date(year, month, 0).getDate())}`;
}

/**
 * Builds a Mongo-style date range from `YYYY-MM-DD` bounds, anchored to
 * the server's local timezone. `startDate` becomes 00:00:00.000 local;
 * `endDate` becomes 23:59:59.999 local (inclusive). Assumes the server
 * runs in the same TZ as the user — true for the current single-user /
 * self-hosted deployment. For multi-TZ deployments, switch to per-user
 * TZ from the User record and pass it in here.
 */
export function utcDayRange(
  startDate?: string,
  endDate?: string,
): { $gte?: Date; $lte?: Date } | null {
  const range: { $gte?: Date; $lte?: Date } = {};
  const start = parseLocalDate(startDate, 0, 0, 0, 0);
  if (start) range.$gte = start;
  const end = parseLocalDate(endDate, 23, 59, 59, 999);
  if (end) range.$lte = end;
  return range.$gte || range.$lte ? range : null;
}

function parseLocalDate(
  iso: string | undefined,
  hh: number,
  mm: number,
  ss: number,
  ms: number,
): Date | null {
  if (!iso) return null;
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [y, m, d] = parts;
  const date = new Date(y, m - 1, d, hh, mm, ss, ms);
  return Number.isNaN(date.getTime()) ? null : date;
}
