import { config } from '../config/environment';
import { BypassAuthVerifier } from './bypass-verifier';
import { FirebaseAuthVerifier } from './firebase-verifier';
import type { IAuthVerifier } from './types';

export function createAuthVerifier(): IAuthVerifier {
  if (config.firebase.authBypass) return new BypassAuthVerifier();
  return new FirebaseAuthVerifier(config.firebase);
}
