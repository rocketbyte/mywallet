export function parsePagination(query: Record<string, any>): { limit: number; offset: number } {
  return {
    limit: Math.min(parseInt(query.limit as string) || 50, 200),
    offset: Math.max(parseInt(query.offset as string) || 0, 0),
  };
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns a request parameter only when it is a plain string scalar. Express'
 * query parser turns `?category[$ne]=x` into an object and `?a=1&a=2` into an
 * array; passing either straight into a Mongo filter is NoSQL operator
 * injection. Any non-string (object, array, undefined) collapses to undefined
 * so callers building queries can safely treat it as "not provided".
 */
export function scalarParam(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
