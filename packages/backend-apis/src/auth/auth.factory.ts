import { config } from '../config/environment';
import { BypassAuthVerifier } from './bypass-verifier';
import { FirebaseAuthVerifier } from './firebase-verifier';
import { MongoUserResolver } from './user.resolver';
import type { AuthVerifierInterface, UserResolverInterface } from './types';

let resolverSingleton: UserResolverInterface | null = null;

export function getUserResolver(): UserResolverInterface {
  if (!resolverSingleton) {
    resolverSingleton = new MongoUserResolver();
  }
  return resolverSingleton;
}

export function createAuthVerifier(): AuthVerifierInterface {
  const resolver = getUserResolver();
  if (config.firebase.authBypass) return new BypassAuthVerifier(resolver);
  return new FirebaseAuthVerifier(config.firebase, resolver);
}
