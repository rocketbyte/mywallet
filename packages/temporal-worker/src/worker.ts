// IMPORTANT: Must be first import for decorator support
import 'reflect-metadata';

import { Worker, NativeConnection } from '@temporalio/worker';
import { OAuth2Client } from 'google-auth-library';
import mongoose from 'mongoose';
import { config, validateConfig } from './config/environment';
import { logger } from './utils/logger';

// Clean Architecture - DI Container
import { DIContainer } from '../../temporal-workflows/src/infrastructure/config/di-container';

// New Activities (Clean Architecture - Controllers)
import { createActivities as createCleanActivities } from '../../temporal-workflows/src/presentation/temporal/activities.index';

// Legacy activity creators and clients (kept temporarily for backward compatibility)
import {
  createGmailActivities,
  createOpenAIActivities,
  createMongoDBActivities,
  createEmailActivities,
  createScheduleActivities,
  createGmailSyncActivities,
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
    // Connect to MongoDB
    logger.info('📦 Connecting to MongoDB...', { uri: config.mongodb.uri.replace(/:[^:@]+@/, ':***@') });
    await mongoose.connect(config.mongodb.uri);
    logger.info('✅ MongoDB connected');

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
      mongoConnection: mongoose.connection,

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

    // ==================== LEGACY ACTIVITIES (Temporary) ====================
    // Keep old activities for gradual migration
    const gmailClient = new GmailClient(oauth2Client);
    const openaiClient = new OpenAIClient(config.openai.apiKey);

    const gmailActivities = createGmailActivities(gmailClient);
    const openaiActivities = createOpenAIActivities(openaiClient);
    const mongodbActivities = createMongoDBActivities(mongoose.connection);
    const emailActivities = createEmailActivities(mongoose.connection);
    const scheduleActivities = createScheduleActivities(mongoose.connection);
    const gmailSyncActivities = createGmailSyncActivities(mongoose.connection);

    // Merge new and legacy activities
    const activities = {
      ...cleanActivities,        // New Clean Architecture activities (will override legacy)
      ...gmailActivities,         // Legacy Gmail activities
      ...openaiActivities,        // Legacy OpenAI activities
      ...mongodbActivities,       // Legacy MongoDB activities
      ...emailActivities,         // Legacy Email activities
      ...scheduleActivities,      // Legacy Schedule activities
      ...gmailSyncActivities      // Legacy Gmail Sync activities
    };

    logger.info('✅ All activities registered (Clean + Legacy)');

    // Connect to Temporal
    logger.info('⏰ Connecting to Temporal...', {
      address: config.temporal.address,
      namespace: config.temporal.namespace
    });

    const connection = await NativeConnection.connect({
      address: config.temporal.address
    });

    logger.info('✅ Connected to Temporal');

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
      await Promise.all([
        worker.shutdown(),
        gmailSyncWorker.shutdown()
      ]);
      await mongoose.disconnect();
      DIContainer.reset();  // Clean up DI Container
      logger.info('👋 Workers shut down gracefully');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Start both workers
    logger.info('👂 Workers polling for tasks...');
    await Promise.all([
      worker.run(),
      gmailSyncWorker.run()
    ]);

  } catch (err) {
    logger.error('❌ Worker failed', { error: err });
    process.exit(1);
  }
}

run().catch((err) => {
  logger.error('❌ Unhandled error in worker', { error: err });
  process.exit(1);
});
