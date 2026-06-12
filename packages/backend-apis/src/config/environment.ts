import * as dotenv from 'dotenv';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '../../.env');
console.log('Loading .env from:', envPath);
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.warn('Warning: Could not load .env file:', result.error.message);
  console.log('Trying alternative path...');
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

console.log('Environment loaded. GMAIL_CLIENT_ID:', process.env.GMAIL_CLIENT_ID ? 'SET' : 'NOT SET');
console.log('Environment loaded. GMAIL_REDIRECT_URI:', process.env.GMAIL_REDIRECT_URI || 'NOT SET');

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

export const config = {
  nodeEnv,
  isProduction,
  port: parseInt(process.env.PORT || '3000', 10),

  temporal: {
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
    namespace: process.env.TEMPORAL_NAMESPACE || 'default'
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info'
  },

  // Cross-origin browser access is restricted to this allowlist. Empty in
  // production means "deny all cross-origin" (see CORS middleware); empty in
  // dev means "allow all" for developer convenience.
  cors: {
    // CORS_ALLOWED_ORIGINS is the canonical name; ALLOWED_ORIGINS is accepted
    // for backwards compatibility with existing deployments.
    allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  },

  // Internal credential gating the admin-only Gmail routes (status/:userId,
  // link, unlink). Fail-closed: when unset the routes are denied entirely.
  admin: {
    apiKey: process.env.ADMIN_API_KEY || '',
  },

  // Google Pub/Sub push delivers a Google-signed OIDC token; we verify its
  // audience (and optionally the pushing service account) before processing a
  // webhook. Required in production — see the fail-fast check below.
  pubsub: {
    verificationAudience: process.env.PUBSUB_VERIFICATION_AUDIENCE || '',
    serviceAccountEmail: process.env.PUBSUB_SERVICE_ACCOUNT_EMAIL || '',
  },

  // Request-body caps. Decompressed cap defends against gzip-bomb DoS.
  bodyLimits: {
    json: process.env.MAX_JSON_BYTES || '256kb',
    maxDecompressedBytes: parseInt(process.env.MAX_DECOMPRESSED_BYTES || `${1024 * 1024}`, 10),
  },

  docs: {
    user: process.env.DOCS_USER || '',
    password: process.env.DOCS_PASSWORD || ''
  },

  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
    // Private key in env files is escaped with \n; convert back to real newlines.
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    authBypass: process.env.AUTH_BYPASS === 'true',
  },

  // LiteLLM proxy — same gateway the temporal worker uses. Reads the same
  // env vars (LITELLM_API_KEY, LITELLM_BASE_URL, OPENAI_MODEL) so anywhere
  // the worker's AI is configured, the chat endpoint inherits that config.
  // LITELLM_MASTER_KEY is accepted as a local-dev fallback to match
  // .env.example. OPENAI_MODEL must be a `model_name` in litellm-config.yaml.
  litellm: {
    baseURL: process.env.LITELLM_BASE_URL || '',
    apiKey: process.env.LITELLM_API_KEY || process.env.LITELLM_MASTER_KEY || '',
    model: process.env.OPENAI_MODEL || 'cf/llama-3.3-70b-instruct-fp8-fast',
    // Chat uses its own model so the worker pipeline (OPENAI_MODEL) and
    // the chat endpoint can be tuned independently.
    chatModel: process.env.CHAT_MODEL || process.env.OPENAI_MODEL || 'cf/llama-3.3-70b-instruct-fp8-fast',
  },
};

if (config.isProduction && !config.pubsub.verificationAudience) {
  // Opt-in for now: warn loudly rather than blocking boot. While unset the Gmail
  // webhook stays unverified — anyone who knows the URL can spoof Pub/Sub
  // notifications. Set PUBSUB_VERIFICATION_AUDIENCE to enforce. Making this a
  // hard requirement in production is tracked as a follow-up change
  // (enforce-pubsub-webhook-oidc).
  console.warn(
    '[security] PUBSUB_VERIFICATION_AUDIENCE is not set — the Gmail webhook is ' +
    'UNVERIFIED. Set it so the webhook can verify Google-signed OIDC push tokens.'
  );
}

if (!config.litellm.baseURL || !config.litellm.apiKey) {
  // Don't crash — chat is one feature among many — but warn loudly so the
  // mismatch is obvious if someone hits POST /api/chat.
  console.warn(
    '[chat] LiteLLM not fully configured. Set LITELLM_BASE_URL and LITELLM_API_KEY ' +
    '(same values the temporal worker uses). Chat requests will fail until both are present.'
  );
}
