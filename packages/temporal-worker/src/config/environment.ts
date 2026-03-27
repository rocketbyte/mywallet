import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from project root
const envPath = path.resolve(process.cwd(), '../../.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
  // Try alternative path if first attempt fails
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',

  temporal: {
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
    namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    taskQueue: process.env.TEMPORAL_TASK_QUEUE || 'email-processing-queue'
  },

  mongodb: {
    uri: process.env.MONGODB_URI || ''
  },

  // Provider selection
  providers: {
    email: process.env.EMAIL_PROVIDER || 'gmail',  // 'gmail' | 'outlook'
    db: process.env.DB_PROVIDER || 'mongodb'        // 'mongodb' | 'prisma'
  },

  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID || '',
    clientSecret: process.env.GMAIL_CLIENT_SECRET || '',
    refreshToken: process.env.GMAIL_REFRESH_TOKEN || ''
  },

  // LiteLLM proxy configuration.
  // All AI calls are routed through LiteLLM — never directly to a model.
  // LITELLM_API_KEY must match LITELLM_MASTER_KEY in the llm-platform secret.
  // OPENAI_MODEL must match a model_name in the LiteLLM configmap.
  litellm: {
    apiKey: process.env.LITELLM_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'cf/llama-3.1-8b-instruct',
    endpoint: process.env.LITELLM_BASE_URL || ''
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info'
  }
};

// Validate required environment variables
export function validateConfig() {
  const required: Array<{ key: string; value: string }> = [];

  if (config.providers.email === 'gmail') {
    required.push(
      { key: 'GMAIL_CLIENT_ID', value: config.gmail.clientId },
      { key: 'GMAIL_CLIENT_SECRET', value: config.gmail.clientSecret },
      { key: 'GMAIL_REFRESH_TOKEN', value: config.gmail.refreshToken }
    );
  }

  required.push(
    { key: 'LITELLM_API_KEY', value: config.litellm.apiKey },
    { key: 'LITELLM_BASE_URL', value: config.litellm.endpoint }
  );

  const missing = required.filter(r => !r.value);

  if (missing.length > 0) {
    console.warn('⚠️  Missing environment variables:', missing.map(m => m.key).join(', '));
    console.warn('Worker will start but may fail when executing activities');
  }

  return missing.length === 0;
}
