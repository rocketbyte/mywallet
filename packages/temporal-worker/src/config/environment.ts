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

  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID || '',
    clientSecret: process.env.GMAIL_CLIENT_SECRET || '',
    refreshToken: process.env.GMAIL_REFRESH_TOKEN || ''
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY || ''
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info'
  }
};

// Validate required environment variables
export function validateConfig() {
  const required = [
    { key: 'GMAIL_CLIENT_ID', value: config.gmail.clientId },
    { key: 'GMAIL_CLIENT_SECRET', value: config.gmail.clientSecret },
    { key: 'GMAIL_REFRESH_TOKEN', value: config.gmail.refreshToken },
    { key: 'OPENAI_API_KEY', value: config.openai.apiKey }
  ];

  const missing = required.filter(r => !r.value);

  if (missing.length > 0) {
    console.warn('⚠️  Missing environment variables:', missing.map(m => m.key).join(', '));
    console.warn('Worker will start but may fail when executing activities');
  }

  return missing.length === 0;
}
