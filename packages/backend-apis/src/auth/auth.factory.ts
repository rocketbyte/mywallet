import { config } from '../config/environment';
import { BypassAuthVerifier } from './bypass-verifier';
import { FirebaseAuthVerifier } from './firebase-verifier';
import { MongoTenantProvisioner } from './tenant.provisioner';
import { MongoUserResolver } from './user.resolver';
import type { AuthVerifierInterface, UserResolverInterface } from './types';

let resolverSingleton: UserResolverInterface | null = null;

export function getUserResolver(): UserResolverInterface {
  if (!resolverSingleton) {
    resolverSingleton = new MongoUserResolver({
      tenantProvisioner: new MongoTenantProvisioner(),
    });
  }
  return resolverSingleton;
}

export function createAuthVerifier(): AuthVerifierInterface {
  const resolver = getUserResolver();
  if (config.firebase.authBypass) {
    // The bypass verifier authenticates nobody — it trusts a header. It must
    // never be wired up in production, even if the env flag is set by mistake.
    if (config.isProduction) {
      throw new Error(
        'AUTH_BYPASS is enabled under NODE_ENV=production. The bypass verifier ' +
        'disables authentication and is refused in production. Unset AUTH_BYPASS.'
      );
    }
    return new BypassAuthVerifier(resolver);
  }
  return new FirebaseAuthVerifier(config.firebase, resolver);
}
