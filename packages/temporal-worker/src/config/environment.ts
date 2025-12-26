import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from project root
const envPath = path.resolve(process.cwd(), '../../.env');
console.log('Loading .env from:', envPath);
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.warn('Warning: Could not load .env file:', result.error.message);
  console.log('Trying alternative path...');
  // Try alternative path if first attempt fails
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

console.log('Environment loaded. GMAIL_REFRESH_TOKEN:', process.env.GMAIL_REFRESH_TOKEN ? 'SET' : 'NOT SET');

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',

  temporal: {
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
    namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    taskQueue: process.env.TEMPORAL_TASK_QUEUE || 'email-processing-queue'
  },

  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://admin:admin123@localhost:27017/mywallet?authSource=admin'
  },

  // Provider selection - enables runtime switching between providers
  providers: {
    email: process.env.EMAIL_PROVIDER || 'gmail',      // 'gmail' | 'outlook'
    ai: process.env.AI_PROVIDER || 'openai'             // 'openai' | 'ollama'
  },

  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID || '',
    clientSecret: process.env.GMAIL_CLIENT_SECRET || '',
    refreshToken: process.env.GMAIL_REFRESH_TOKEN || ''
  },

  // OpenAI configuration (supports custom endpoints)
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    endpoint: process.env.OPENAI_ENDPOINT  // Optional custom endpoint
  },

  // Ollama configuration (supports remote servers)
  ollama: {
    endpoint: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434',
    model: process.env.OLLAMA_MODEL || 'phi3:mini'
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info'
  }
};

// Validate required environment variables based on selected providers
export function validateConfig() {
  const required: Array<{ key: string; value: string }> = [];

  // Validate email provider configuration
  if (config.providers.email === 'gmail') {
    required.push(
      { key: 'GMAIL_CLIENT_ID', value: config.gmail.clientId },
      { key: 'GMAIL_CLIENT_SECRET', value: config.gmail.clientSecret },
      { key: 'GMAIL_REFRESH_TOKEN', value: config.gmail.refreshToken }
    );
  }
  // Future: Add Outlook validation here

  // Validate AI provider configuration
  if (config.providers.ai === 'openai') {
    required.push(
      { key: 'OPENAI_API_KEY', value: config.openai.apiKey }
    );
  } else if (config.providers.ai === 'ollama') {
    required.push(
      { key: 'OLLAMA_ENDPOINT', value: config.ollama.endpoint }
    );
  }

  const missing = required.filter(r => !r.value);

  if (missing.length > 0) {
    console.warn('⚠️  Missing environment variables:', missing.map(m => m.key).join(', '));
    console.warn('Worker will start but may fail when executing activities');
  }

  return missing.length === 0;
}
