import { Worker, NativeConnection } from '@temporalio/worker';
import { OAuth2Client } from 'google-auth-library';
import mongoose from 'mongoose';
import { config, validateConfig } from './config/environment';
import { logger } from './utils/logger';

// Import activity creators and clients
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
    const gmailClient = new GmailClient(oauth2Client);
    logger.info('✅ Gmail client initialized');

    // Initialize OpenAI Client
    logger.info('🤖 Initializing OpenAI client...');
    const openaiClient = new OpenAIClient(config.openai.apiKey);
    logger.info('✅ OpenAI client initialized');

    // Create activities with dependency injection
    const gmailActivities = createGmailActivities(gmailClient);
    const openaiActivities = createOpenAIActivities(openaiClient);
    const mongodbActivities = createMongoDBActivities(mongoose.connection);
    const emailActivities = createEmailActivities(mongoose.connection);
    const scheduleActivities = createScheduleActivities(mongoose.connection);
    const gmailSyncActivities = createGmailSyncActivities(mongoose.connection);

    const activities = {
      ...gmailActivities,
      ...openaiActivities,
      ...mongodbActivities,
      ...emailActivities,
      ...scheduleActivities,
      ...gmailSyncActivities
    };

    logger.info('✅ All activities registered');

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
