import './config/environment';

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import mongoose from 'mongoose';
import { createGunzip } from 'zlib';
import type { CorsOptions } from 'cors';
import { config } from './config/environment';
import routes from './routes';
import { errorHandler } from './middleware/error-handler';
import { baselineLimiter } from './middleware/rate-limit';
import { logger, redact } from './utils/logger';
import { swaggerSpec } from './config/swagger';
import { redocMiddleware } from './middleware/redoc';
import { docsAuth } from './middleware/docs-auth';
import { createAuthVerifier, requireAuth } from './auth';
import { Budget } from '../../temporal-workflows/src/models';

const app = express();

// Helper to bypass TypeScript's transpilation of dynamic import() to require()
// This ensures we can load ESM-only modules in a CommonJS environment
const esmImport = new Function('path', 'return import(path)');

async function connectMongoDB() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is not defined');
    }
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info('Connected to MongoDB');
    await Budget.syncIndexes();
  } catch (error) {
    logger.error('Failed to connect to MongoDB', { error });
    process.exit(1);
  }
}

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Essential for loading assets like Redoc/Scalar from CDNs
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'cdn.jsdelivr.net', 'https://cdn.redoc.ly', 'https://unpkg.com'],
        'style-src': ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'cdn.jsdelivr.net', 'https://cdn.redoc.ly'],
        'img-src': ["'self'", 'data:', 'https://cdn.redoc.ly', 'https://scalar.com', 'https://avatars.githubusercontent.com'],
        'font-src': ["'self'", 'fonts.gstatic.com', 'https://cdn.redoc.ly', 'data:'],
        'connect-src': ["'self'", 'https://cdn.redoc.ly', 'https://unpkg.com'],
        'worker-src': ["'self'", 'blob:'],
      },
    },
  })
);
// CORS is restricted to an explicit allowlist. Requests with no Origin
// (server-to-server, curl, Pub/Sub) always pass; browser requests from
// unlisted origins receive no allow-origin header. An empty allowlist denies
// cross-origin in production but allows all in development for convenience.
const corsOptions: CorsOptions = {
  credentials: true,
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (config.cors.allowedOrigins.includes(origin)) return callback(null, true);
    if (config.cors.allowedOrigins.length === 0 && !config.isProduction) {
      return callback(null, true);
    }
    return callback(null, false);
  },
};
app.use(cors(corsOptions));

// cors() answers (204) preflights from allowed origins, but for a disallowed
// origin it calls next() instead of terminating — which would let the OPTIONS
// fall through to the /api auth gate and 401. Answer any remaining preflight
// here with a clean 204 (no allow-origin header, so the browser still blocks
// the actual cross-origin request) before auth or rate limiting can see it.
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// Baseline rate limit across the whole surface.
app.use(baselineLimiter);

app.use((req, res, next) => {
  if (req.headers['content-encoding'] === 'gzip') {
    const gunzip = createGunzip();
    req.pipe(gunzip);
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    gunzip.on('data', (chunk: Buffer) => {
      if (aborted) return;
      total += chunk.length;
      // Cap the *decompressed* size to defeat gzip-bomb DoS.
      if (total > config.bodyLimits.maxDecompressedBytes) {
        aborted = true;
        gunzip.destroy();
        logger.warn('Rejected oversized gzip body', { decompressedBytes: total });
        res.status(413).json({ error: 'PayloadTooLarge', message: 'Request body too large' });
        return;
      }
      chunks.push(chunk);
    });
    gunzip.on('end', () => {
      if (aborted) return;
      const body = Buffer.concat(chunks).toString('utf-8');
      try {
        req.body = JSON.parse(body);
      } catch {
        req.body = body;
      }
      next();
    });
    gunzip.on('error', (err) => {
      if (aborted) return;
      logger.error('Failed to decompress gzip body', { err });
      next(err);
    });
  } else {
    next();
  }
});

app.use(express.json({ limit: config.bodyLimits.json }));

app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    query: redact(req.query),
    body: redact(req.body)
  });
  next();
});

// Routes — Firebase ID token auth on /api/*, except endpoints called by external
// systems that cannot send user tokens (k8s probes, Google Pub/Sub, OAuth redirect).
const openApiPaths: RegExp[] = [
  /^\/health(\/.*)?$/,
  /^\/gmail\/webhook\/?$/,
  /^\/auth\/[^/]+\/callback\/?$/, // OAuth callback — provider-agnostic, called by Google/etc.
];
const authMiddleware = requireAuth(createAuthVerifier());
app.use(
  '/api',
  (req, res, next) => {
    if (openApiPaths.some((re) => re.test(req.path))) return next();
    return authMiddleware(req, res, next);
  },
  routes
);

app.get('/docs/openapi.json', docsAuth, (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

app.use(
  '/docs/playground',
  docsAuth,
  async (req, res, next) => {
    try {
      const { apiReference } = await esmImport('@scalar/express-api-reference');
      return apiReference({
        spec: {
          content: swaggerSpec,
        },
        theme: 'deepSpace',
        showSidebar: true,
        customCss: `
          :root {
            --scalar-font-header: 'Outfit', sans-serif;
            --scalar-font-body: 'Outfit', sans-serif;
            --scalar-font-code: 'Fira Code', monospace;
            --scalar-primary: #6B46C1;
          }
        `
      })(req, res, next);
    } catch (err) {
      next(err);
    }
  }
);

app.use(errorHandler);

const PORT = config.port;

connectMongoDB().then(() => {
  app.listen(PORT, () => {
    logger.info(`MyWallet API Server listening on port ${PORT}`);
    logger.info(`Environment: ${config.nodeEnv}`);
    logger.info(`Temporal address: ${config.temporal.address}`);
    logger.info(`\nReady to accept requests!\n`);
  });
});

process.on('SIGINT', async () => {
  logger.info('Shutting down API server...');
  await mongoose.disconnect();
  logger.info('Disconnected from MongoDB');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down API server...');
  await mongoose.disconnect();
  logger.info('Disconnected from MongoDB');
  process.exit(0);
});
