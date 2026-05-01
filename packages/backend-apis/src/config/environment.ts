import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from project root
// Use process.cwd() to get the directory where npm run dev was executed
const envPath = path.resolve(process.cwd(), '../../.env');
console.log('Loading .env from:', envPath);
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.warn('Warning: Could not load .env file:', result.error.message);
  console.log('Trying alternative path...');
  // Try alternative path if first attempt fails
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

console.log('Environment loaded. GMAIL_CLIENT_ID:', process.env.GMAIL_CLIENT_ID ? 'SET' : 'NOT SET');
console.log('Environment loaded. GMAIL_REDIRECT_URI:', process.env.GMAIL_REDIRECT_URI || 'NOT SET');

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),

  temporal: {
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
    namespace: process.env.TEMPORAL_NAMESPACE || 'default'
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info'
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
};
