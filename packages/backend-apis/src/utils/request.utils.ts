import { Request } from 'express';

export function getUserId(req: Request): string {
  const userId = (req as any).user?.id;
  if (!userId) {
    throw new Error('No authenticated user on request — firebaseAuthMiddleware must run before this handler');
  }
  return userId;
}

export function parsePagination(query: Record<string, any>): { limit: number; offset: number } {
  return {
    limit: Math.min(parseInt(query.limit as string) || 50, 200),
    offset: Math.max(parseInt(query.offset as string) || 0, 0),
  };
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
