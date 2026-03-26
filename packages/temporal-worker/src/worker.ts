// IMPORTANT: Must be first import for decorator support
import 'reflect-metadata';

import { Worker, NativeConnection } from '@temporalio/worker';
import { Client } from '@temporalio/client';
import { OAuth2Client } from 'google-auth-library';
import mongoose from 'mongoose';
import { PrismaClient } from '@prisma/client';
import { config, validateConfig } from './config/environment';
import { logger } from './utils/logger';

// Clean Architecture - DI Container
import { DIContainer } from '../../temporal-workflows/src/infrastructure/config/di-container';

// New Activities (Clean Architecture - Controllers)
import { createActivities as createCleanActivities } from '../../temporal-workflows/src/infrastructure/temporal/activities.index';

// Legacy activity creators and clients (kept temporarily for backward compatibility)
import {
  createGmailActivities,
  createOpenAIActivities,
  createMongoDBActivities,
  createEmailActivities,
  createScheduleActivities,
  createWorkflowStarterActivities,
  GmailClient,
  OpenAIClient
} from '../../temporal-workflows/src/activities';

// Import constants
import { GMAIL_SYNC_TASK_QUEUE } from '../../temporal-workflows/src/shared/constants';

async function run() {
  logger.info('🚀 Starting Temporal Worker...');

  // Validate configuration
  const configValid = validateConfig();
  if (!configValid) {
    logger.warn('Configuration validation failed - some features may not work');
  }

  try {
    // Connect to database (MongoDB or Prisma/Supabase)
    const dbProvider = config.providers.db as 'mongodb' | 'prisma';
    let prismaClient: PrismaClient | undefined;

    if (dbProvider === 'prisma') {
      logger.info('🐘 Connecting to Supabase via Prisma...');
      prismaClient = new PrismaClient();
      await prismaClient.$connect();
      logger.info('✅ Prisma (Supabase) connected');
    } else {
      logger.info('📦 Connecting to MongoDB...', { uri: config.mongodb.uri.replace(/:[^:@]+@/, ':***@') });
      await mongoose.connect(config.mongodb.uri);
      logger.info('✅ MongoDB connected');
    }

    // Initialize Gmail OAuth2 Client
    logger.info('📧 Initializing Gmail client...');
    const oauth2Client = new OAuth2Client(
      config.gmail.clientId,
      config.gmail.clientSecret
    );
    oauth2Client.setCredentials({
      refresh_token: config.gmail.refreshToken
    });
    logger.info('✅ Gmail client initialized');

    // ==================== CLEAN ARCHITECTURE SETUP ====================
    logger.info('🔧 Setting up Clean Architecture DI Container...');
    logger.info(`📧 Email Provider: ${config.providers.email}`);
    logger.info(`🤖 AI Provider: ${config.providers.ai}`);

    // Setup DI Container with provider configuration
    DIContainer.setup({
      emailProvider: config.providers.email as 'gmail',
      aiProvider: config.providers.ai as 'openai' | 'ollama',
      dbProvider,
      mongoConnection: dbProvider === 'mongodb' ? mongoose.connection : undefined,
      prismaClient,

      // Gmail configuration
      gmailOAuth2Client: oauth2Client,

      // OpenAI configuration
      openaiApiKey: config.openai.apiKey,
      openaiModel: config.openai.model,
      openaiEndpoint: config.openai.endpoint,

      // Ollama configuration
      ollamaEndpoint: config.ollama.endpoint,
      ollamaModel: config.ollama.model
    });

    const container = DIContainer.getContainer();
    logger.info('✅ DI Container initialized');

    // Create new Clean Architecture activities
    const cleanActivities = createCleanActivities(container);
    logger.info('✅ Clean Architecture activities created');

    // Connect to Temporal first (needed for workflow starter activities)
    logger.info('⏰ Connecting to Temporal...', {
      address: config.temporal.address,
      namespace: config.temporal.namespace
    });

    const connection = await NativeConnection.connect({
      address: config.temporal.address
    });

    logger.info('✅ Connected to Temporal');

    // Create Temporal client for workflow starter activities
    const temporalClient = new Client({
      connection,
      namespace: config.temporal.namespace
    });

    logger.info('✅ Temporal client created');

    // ==================== LEGACY ACTIVITIES (Temporary) ====================
    const gmailClient = new GmailClient(oauth2Client);
    const openaiClient = new OpenAIClient(config.openai.apiKey);

    const gmailActivities = createGmailActivities(gmailClient);
    const openaiActivities = createOpenAIActivities(openaiClient);
    const workflowStarterActivities = createWorkflowStarterActivities(temporalClient);

    // Legacy MongoDB activities only registered when using MongoDB provider
    const legacyMongoActivities = dbProvider === 'mongodb'
      ? {
          ...createMongoDBActivities(mongoose.connection),
          ...createEmailActivities(mongoose.connection),
          ...createScheduleActivities(mongoose.connection),
        }
      : {};

    // Merge new and legacy activities (clean activities take precedence)
    const activities = {
      ...cleanActivities,
      ...gmailActivities,
      ...openaiActivities,
      ...legacyMongoActivities,
      ...workflowStarterActivities,
    };

    logger.info('✅ All activities registered (Clean + Legacy + Workflow Starter)');

    // Create main worker
    const worker = await Worker.create({
      connection,
      namespace: config.temporal.namespace,
      taskQueue: config.temporal.taskQueue,
      workflowsPath: require.resolve('../../temporal-workflows/src/workflows'),
      activities,
      maxConcurrentActivityTaskExecutions: 5, // Limit concurrent API calls
      maxConcurrentWorkflowTaskExecutions: 10
    });

    logger.info('✅ Main worker created successfully', {
      taskQueue: config.temporal.taskQueue,
      maxConcurrentActivities: 5,
      maxConcurrentWorkflows: 10
    });

    // Create Gmail Sync worker for dedicated task queue
    const gmailSyncWorker = await Worker.create({
      connection,
      namespace: config.temporal.namespace,
      taskQueue: GMAIL_SYNC_TASK_QUEUE,
      workflowsPath: require.resolve('../../temporal-workflows/src/workflows'),
      activities,
      maxConcurrentActivityTaskExecutions: 10,
      maxConcurrentWorkflowTaskExecutions: 20
    });

    logger.info('✅ Gmail Sync worker created successfully', {
      taskQueue: GMAIL_SYNC_TASK_QUEUE,
      maxConcurrentActivities: 10,
      maxConcurrentWorkflows: 20
    });

    // Handle graceful shutdown
    const shutdown = async () => {
      logger.info('🛑 Shutting down workers...');
      await Promise.all([worker.shutdown(), gmailSyncWorker.shutdown()]);
      if (dbProvider === 'prisma' && prismaClient) {
        await prismaClient.$disconnect();
      } else {
        await mongoose.disconnect();
      }
      DIContainer.reset();
      logger.info('👋 Workers shut down gracefully');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Start workers
    logger.info('👂 Workers polling for tasks...');
    await Promise.all([
      worker.run(),
      gmailSyncWorker.run()
    ]);

  } catch (err: any) {
    logger.error('❌ Worker failed', { 
      error: err.message || err, 
      stack: err.stack 
    });
    process.exit(1);
  }
}

run().catch((err: any) => {
  logger.error('❌ Unhandled error in worker', { 
    error: err.message || err,
    stack: err.stack 
  });
  process.exit(1);
});
