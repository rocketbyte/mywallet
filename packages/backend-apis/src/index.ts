// IMPORTANT: Load environment variables FIRST before any other imports
import './config/environment';

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import mongoose from 'mongoose';
import { createGunzip } from 'zlib';
import { config } from './config/environment';
import routes from './routes';
import { errorHandler } from './middleware/error-handler';
import { logger } from './utils/logger';
import { swaggerSpec } from './config/swagger';
import { redocMiddleware } from './middleware/redoc';

const app = express();

// Helper to bypass TypeScript's transpilation of dynamic import() to require()
// This ensures we can load ESM-only modules in a CommonJS environment
const esmImport = new Function('path', 'return import(path)');

// Connect to MongoDB
async function connectMongoDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://admin:admin123@localhost:27017/mywallet?authSource=admin');
    logger.info('✅ Connected to MongoDB');
  } catch (error) {
    logger.error('❌ Failed to connect to MongoDB', { error });
    process.exit(1);
  }
}

// Security & parsing middleware
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
app.use(cors());

// Handle gzip-compressed bodies
app.use((req, res, next) => {
  if (req.headers['content-encoding'] === 'gzip') {
    const gunzip = createGunzip();
    req.pipe(gunzip);
    const chunks: Buffer[] = [];
    gunzip.on('data', (chunk) => chunks.push(chunk));
    gunzip.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8');
      try {
        req.body = JSON.parse(body);
      } catch {
        req.body = body;
      }
      next();
    });
    gunzip.on('error', (err) => {
      logger.error('Failed to decompress gzip body', { err });
      next(err);
    });
  } else {
    next();
  }
});

app.use(express.json());

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    query: req.query,
    body: req.body
  });
  next();
});

// Routes
app.use('/api', routes);

// Documentation
app.get('/docs/openapi.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

app.get(
  '/docs/reference',
  redocMiddleware({
    title: 'MyWallet API Reference',
    spec: swaggerSpec,
  })
);


app.use(
  '/docs/playground',
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

// Error handling
app.use(errorHandler);

const PORT = config.port;

// Connect to MongoDB and start server
connectMongoDB().then(() => {
  app.listen(PORT, () => {
    logger.info(`🚀 MyWallet API Server listening on port ${PORT}`);
    logger.info(`📍 Environment: ${config.nodeEnv}`);
    logger.info(`⏰ Temporal address: ${config.temporal.address}`);
    logger.info(`\n✅ Ready to accept requests!\n`);
  });
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('🛑 Shutting down API server...');
  await mongoose.disconnect();
  logger.info('✅ Disconnected from MongoDB');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('🛑 Shutting down API server...');
  await mongoose.disconnect();
  logger.info('✅ Disconnected from MongoDB');
  process.exit(0);
});
