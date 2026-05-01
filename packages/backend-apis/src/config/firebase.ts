import admin from 'firebase-admin';
import { config } from './environment';
import { logger } from '../utils/logger';

let initialized = false;

export function initFirebase(): typeof admin | null {
  if (initialized) return admin;

  const { projectId, clientEmail, privateKey } = config.firebase;

  if (!projectId || !clientEmail || !privateKey) {
    if (config.firebase.authBypass) {
      logger.warn('Firebase Admin not initialized — AUTH_BYPASS is enabled');
      initialized = true;
      return null;
    }
    throw new Error(
      'Firebase Admin credentials missing. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY (or enable AUTH_BYPASS=true for local dev).'
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });

  initialized = true;
  logger.info('Firebase Admin initialized', { projectId });
  return admin;
}

export function firebaseAuth(): admin.auth.Auth {
  if (!initialized) initFirebase();
  return admin.auth();
}
