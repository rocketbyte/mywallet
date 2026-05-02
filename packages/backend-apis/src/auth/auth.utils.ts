import type { Request } from 'express';

export function getUserId(req: Request): string {
  if (!req.user?.id) {
    throw new Error('No authenticated user on request — requireAuth middleware must run before this handler');
  }
  return req.user.id;
}
