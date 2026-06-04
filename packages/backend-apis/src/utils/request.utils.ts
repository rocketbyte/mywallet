export function parsePagination(query: Record<string, any>): { limit: number; offset: number } {
  return {
    limit: Math.min(parseInt(query.limit as string) || 50, 200),
    offset: Math.max(parseInt(query.offset as string) || 0, 0),
  };
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
