// IMPORTANT: Must be first import for decorator support
import 'reflect-metadata';

import { Worker, NativeConnection } from '@temporalio/worker';
import mongoose from 'mongoose';
import { config, validateConfig } from './config/environment';
import { logger } from './utils/logger';
import { OAuth2Client } from 'google-auth-library';

// Clean Architecture - DI Container
import { DIContainer } from '../../temporal-workflows/src/infrastructure/config/di-container';
import { createActivities as createCleanActivities } from '../../temporal-workflows/src/infrastructure/temporal/activities.index';

// Legacy activities needed by pipeline (MongoDB store step)
import {
  createMongoDBActivities,
  createEmailActivities
} from '../../temporal-workflows/src/activities';

import { TASK_QUEUES } from '../../temporal-workflows/src/shared/constants';

async function run() {
  logger.info('🚀 Starting Pipeline Worker...');

  const configValid = validateConfig();
  if (!configValid) {
    logger.warn('Configuration validation failed - some features may not work');
  }

  try {
    logger.info('📦 Connecting to MongoDB...', { uri: config.mongodb.uri.replace(/:[^:@]+@/, ':***@') });
    await mongoose.connect(config.mongodb.uri);
    logger.info('✅ MongoDB connected');

    const oauth2Client = new OAuth2Client(
      config.gmail.clientId,
      config.gmail.clientSecret
    );

    DIContainer.setup({
      emailProvider: config.providers.email as 'gmail',
      aiProvider: config.providers.ai as 'openai' | 'ollama',
      mongoConnection: mongoose.connection,
      gmailOAuth2Client: oauth2Client,
      openaiApiKey: config.openai.apiKey,
      openaiModel: config.openai.model,
      openaiEndpoint: config.openai.endpoint,
      ollamaEndpoint: config.ollama.endpoint,
      ollamaModel: config.ollama.model
    });

    const container = DIContainer.getContainer();
    logger.info('✅ DI Container initialized');

    const cleanActivities = createCleanActivities(container);
    const mongodbActivities = createMongoDBActivities(mongoose.connection);
    const emailActivities = createEmailActivities(mongoose.connection);

    const activities = {
      ...cleanActivities,
      ...mongodbActivities,
      ...emailActivities
    };

    logger.info('✅ Pipeline activities ready');

    logger.info('⏰ Connecting to Temporal...', {
      address: config.temporal.address,
      namespace: config.temporal.namespace
    });

    const connection = await NativeConnection.connect({
      address: config.temporal.address
    });

    logger.info('✅ Connected to Temporal');

    const pipelineWorker = await Worker.create({
      connection,
      namespace: config.temporal.namespace,
      taskQueue: TASK_QUEUES.PIPELINE,
      workflowsPath: require.resolve('../../temporal-workflows/src/workflows'),
      activities,
      maxConcurrentActivityTaskExecutions: 1,
      maxConcurrentWorkflowTaskExecutions: 2
    });

    logger.info('✅ Pipeline worker created', {
      taskQueue: TASK_QUEUES.PIPELINE,
      maxConcurrentActivities: 1
    });

    const shutdown = async () => {
      logger.info('🛑 Shutting down pipeline worker...');
      await pipelineWorker.shutdown();
      await mongoose.disconnect();
      DIContainer.reset();
      logger.info('👋 Pipeline worker shut down gracefully');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    logger.info('👂 Pipeline worker polling pipeline-queue...');
    await pipelineWorker.run();

  } catch (err: any) {
    logger.error('❌ Pipeline worker failed', {
      error: err.message || err,
      stack: err.stack
    });
    process.exit(1);
  }
}

run().catch((err: any) => {
  logger.error('❌ Unhandled error in pipeline worker', {
    error: err.message || err,
    stack: err.stack
  });
  process.exit(1);
});
