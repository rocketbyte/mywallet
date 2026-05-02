import type { Request } from 'express';

export interface AuthUser {
  id: string;
  email?: string;
  name?: string;
  emailVerified?: boolean;
}

export interface FirebaseCredentials {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/**
 * Strategy contract for resolving an authenticated user from an incoming
 * request. Implementations decide which credential to look at (Bearer token,
 * dev header, future API key, etc.) and how to validate it.
 */
export interface IAuthVerifier {
  verify(req: Request): Promise<AuthUser>;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}
