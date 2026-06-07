// IMPORTANT: Must be first import for decorator support
import 'reflect-metadata';

import { Worker, NativeConnection } from '@temporalio/worker';
import mongoose from 'mongoose';
import { config, validateConfig } from './config/environment';
import { logger } from './utils/logger';

import { createRecurringActivities } from '../../temporal-workflows/src/infrastructure/temporal/activities/recurring.activities';
import { TASK_QUEUES } from '../../temporal-workflows/src/shared/constants';

/**
 * Recurring Transactions Worker.
 *
 * Serves the dedicated `recurring-queue` for the monthly recurring-transactions
 * job. Its activities are pure MongoDB upserts (no AI), so unlike the pipeline
 * worker it runs high activity concurrency. Scale throughput by raising the
 * concurrency below or adding replicas. MongoDB-only — no DI/LLM setup needed.
 */
async function run() {
  logger.info('🚀 Starting Recurring Transactions Worker...');

  if (!validateConfig()) {
    logger.warn('Configuration validation failed - some features may not work');
  }

  try {
    logger.info('📦 Connecting to MongoDB...', { uri: config.mongodb.uri.replace(/:[^:@]+@/, ':***@') });
    await mongoose.connect(config.mongodb.uri);
    logger.info('✅ MongoDB connected');

    const activities = createRecurringActivities();

    logger.info('⏰ Connecting to Temporal...', {
      address: config.temporal.address,
      namespace: config.temporal.namespace,
    });
    const connection = await NativeConnection.connect({ address: config.temporal.address });
    logger.info('✅ Connected to Temporal');

    const worker = await Worker.create({
      connection,
      namespace: config.temporal.namespace,
      taskQueue: TASK_QUEUES.RECURRING,
      workflowsPath: require.resolve('../../temporal-workflows/src/workflows'),
      activities,
      // Pure DB writes — safe to parallelize aggressively, unlike the AI pipeline.
      maxConcurrentActivityTaskExecutions: 50,
      maxConcurrentWorkflowTaskExecutions: 20,
    });

    logger.info('✅ Recurring worker created', { taskQueue: TASK_QUEUES.RECURRING });

    const shutdown = async () => {
      logger.info('🛑 Shutting down recurring worker...');
      await worker.shutdown();
      await mongoose.disconnect();
      logger.info('👋 Recurring worker shut down gracefully');
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    logger.info('👂 Recurring worker polling recurring-queue...');
    await worker.run();
  } catch (err: any) {
    logger.error('❌ Recurring worker failed', { error: err.message || err, stack: err.stack });
    process.exit(1);
  }
}

run().catch((err: any) => {
  logger.error('❌ Unhandled error in recurring worker', { error: err.message || err, stack: err.stack });
  process.exit(1);
});
