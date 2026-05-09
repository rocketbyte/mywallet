import type { Request } from 'express';

export function getUserId(req: Request): string {
  if (!req.user?.id) {
    throw new Error('No authenticated user on request — requireAuth middleware must run before this handler');
  }
  return req.user.id;
}

/**
 * Returns the id of the user whose data the caller should read/write.
 * For a tenant's primary user this equals their own id; for a member
 * this is the tenant's primaryUserId. Falls back to the authed user's
 * id only if the resolver didn't populate dataOwnerId — i.e. the user
 * has no tenant yet, which shouldn't happen post-provisioning.
 */
export function getDataOwnerId(req: Request): string {
  if (!req.user?.id) {
    throw new Error('No authenticated user on request — requireAuth middleware must run before this handler');
  }
  return req.user.dataOwnerId ?? req.user.id;
}

export function getTenantId(req: Request): string {
  if (!req.user?.tenantId) {
    throw new Error('No tenant on request — provisioner must run before this handler');
  }
  return req.user.tenantId;
}
