import { Request, Response } from 'express';
import { Connection } from 'mongoose';
import { getTemporalClient } from '../config/temporal-client';
import { scheduledEmailProcessingWorkflow } from '../../../temporal-workflows/src/workflows';
import { TASK_QUEUES } from '../../../temporal-workflows/src/shared/constants';
import { createScheduleActivities } from '../../../temporal-workflows/src/activities/database/schedule.activities';
import { ScheduleConfig } from '../../../temporal-workflows/src/models';
import { logger } from '../utils/logger';

export class ScheduleController {
  private scheduleActivities: ReturnType<typeof createScheduleActivities>;

  constructor(mongoConnection: Connection) {
    this.scheduleActivities = createScheduleActivities(mongoConnection);
  }

  /**
   * POST /api/schedules/email-processing
   * Create and start a scheduled email processing workflow
   */
  async createSchedule(req: Request, res: Response) {
    try {
      // Extract userId from auth or header
      const userId = (req as any).user?.id || req.headers['x-user-id'] as string;

      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'userId is required. Provide via authentication or x-user-id header.'
        });
      }

      const {
        name,
        description,
        searchQuery = 'subject:"Usaste tu tarjeta de credito"',
        cronExpression = '* * * * *', // Every minute
        maxResults = 50,
        afterDate
      } = req.body;

      if (!name) {
        return res.status(400).json({
          error: 'Name is required',
          message: 'Please provide a name for the schedule'
        });
      }

      const client = await getTemporalClient();

      // Generate unique schedule ID with userId
      const scheduleId = `email-processing-schedule-${userId}-${Date.now()}`;

      // Create schedule configuration in MongoDB
      await this.scheduleActivities.createScheduleConfig({
        userId,
        scheduleId,
        name,
        description,
        searchQuery,
        cronExpression,
        maxResults,
        afterDate: afterDate ? new Date(afterDate) : undefined
      });

      // Create Temporal schedule
      const handle = await client.schedule.create({
        scheduleId,
        spec: {
          cronExpressions: [cronExpression],
        },
        action: {
          type: 'startWorkflow',
          workflowType: scheduledEmailProcessingWorkflow,
          taskQueue: TASK_QUEUES.EMAIL_PROCESSING,
          args: [{
            userId,
            scheduleId,
            searchQuery,
            maxResults,
            afterDate: afterDate ? new Date(afterDate) : undefined,
            skipProcessed: true
          }]
        },
        policies: {
          catchupWindow: '1 minute',
          pauseOnFailure: false
        }
      });

      logger.info('Created email processing schedule', {
        userId,
        scheduleId,
        name,
        searchQuery,
        cronExpression
      });

      res.status(201).json({
        userId,
        scheduleId: handle.scheduleId,
        name,
        description,
        searchQuery,
        cronExpression,
        maxResults,
        status: 'created',
        message: 'Email processing schedule created successfully'
      });

    } catch (error) {
      logger.error('Failed to create schedule', { error });
      res.status(500).json({
        error: 'Failed to create schedule',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * DELETE /api/schedules/:scheduleId
   * Stop and delete a schedule
   */
  async deleteSchedule(req: Request, res: Response) {
    try {
      // Extract userId from auth or header
      const userId = (req as any).user?.id || req.headers['x-user-id'] as string;

      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'userId is required. Provide via authentication or x-user-id header.'
        });
      }

      const { scheduleId } = req.params;

      // Verify schedule belongs to this user
      const config = await this.scheduleActivities.getScheduleConfig(scheduleId);
      if (!config || config.userId !== userId) {
        return res.status(404).json({
          error: 'Schedule not found',
          message: `No schedule found with ID: ${scheduleId}`
        });
      }

      const client = await getTemporalClient();
      const handle = client.schedule.getHandle(scheduleId);

      // Delete from Temporal
      await handle.delete();

      // Delete configuration from MongoDB
      await this.scheduleActivities.deleteScheduleConfig(scheduleId);

      logger.info('Deleted schedule', { userId, scheduleId });

      res.json({
        userId,
        scheduleId,
        status: 'deleted',
        message: 'Schedule deleted successfully'
      });

    } catch (error) {
      logger.error('Failed to delete schedule', { error });
      res.status(500).json({
        error: 'Failed to delete schedule',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * GET /api/schedules/:scheduleId
   * Get schedule information and status
   */
  async getSchedule(req: Request, res: Response) {
    try {
      // Extract userId from auth or header
      const userId = (req as any).user?.id || req.headers['x-user-id'] as string;

      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'userId is required. Provide via authentication or x-user-id header.'
        });
      }

      const { scheduleId } = req.params;

      // Get configuration from MongoDB
      const config = await this.scheduleActivities.getScheduleConfig(scheduleId);

      if (!config) {
        return res.status(404).json({
          error: 'Schedule configuration not found',
          message: `No configuration found for schedule: ${scheduleId}`
        });
      }

      // Verify schedule belongs to this user
      if (config.userId !== userId) {
        return res.status(404).json({
          error: 'Schedule not found',
          message: `No schedule found with ID: ${scheduleId}`
        });
      }

      const client = await getTemporalClient();
      const handle = client.schedule.getHandle(scheduleId);

      // Get schedule description from Temporal
      const description = await handle.describe();

      res.json({
        userId,
        scheduleId: description.scheduleId,
        name: config.name,
        description: config.description,
        isActive: config.isActive,
        searchQuery: config.searchQuery,
        cronExpression: config.cronExpression,
        maxResults: config.maxResults,
        afterDate: config.afterDate,
        nextRunTime: description.info.nextActionTimes?.[0],
        lastRunAt: config.lastRunAt,
        lastRunStatus: config.lastRunStatus,
        stats: {
          totalRuns: config.totalRuns,
          totalEmailsFetched: config.totalEmailsFetched,
          totalEmailsProcessed: config.totalEmailsProcessed,
          totalErrors: config.totalErrors
        },
        createdAt: config.createdAt,
        updatedAt: config.updatedAt
      });

    } catch (error) {
      logger.error('Failed to get schedule', { error });
      res.status(500).json({
        error: 'Failed to fetch schedule',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * GET /api/schedules
   * List all schedules
   */
  async listSchedules(req: Request, res: Response) {
    try {
      // Extract userId from auth or header
      const userId = (req as any).user?.id || req.headers['x-user-id'] as string;

      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'userId is required. Provide via authentication or x-user-id header.'
        });
      }

      // Get schedules for this user only
      const configs = await ScheduleConfig.find({ userId });

      const client = await getTemporalClient();

      // Get Temporal schedule info for each
      const schedules = await Promise.all(
        configs.map(async (config) => {
          try {
            const handle = client.schedule.getHandle(config.scheduleId);
            const description = await handle.describe();

            return {
              scheduleId: config.scheduleId,
              name: config.name,
              description: config.description,
              isActive: config.isActive,
              searchQuery: config.searchQuery,
              cronExpression: config.cronExpression,
              nextRunTime: description.info.nextActionTimes?.[0],
              lastRunAt: config.lastRunAt,
              lastRunStatus: config.lastRunStatus,
              stats: {
                totalRuns: config.totalRuns,
                totalEmailsFetched: config.totalEmailsFetched,
                totalEmailsProcessed: config.totalEmailsProcessed,
                totalErrors: config.totalErrors
              }
            };
          } catch (error) {
            logger.error('Failed to get schedule info', {
              scheduleId: config.scheduleId,
              error
            });
            return {
              scheduleId: config.scheduleId,
              name: config.name,
              error: 'Failed to fetch Temporal schedule info'
            };
          }
        })
      );

      res.json({
        userId,
        schedules,
        total: schedules.length
      });

    } catch (error) {
      logger.error('Failed to list schedules', { error });
      res.status(500).json({
        error: 'Failed to list schedules',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * POST /api/schedules/:scheduleId/pause
   * Pause a schedule
   */
  async pauseSchedule(req: Request, res: Response) {
    try {
      // Extract userId from auth or header
      const userId = (req as any).user?.id || req.headers['x-user-id'] as string;

      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'userId is required. Provide via authentication or x-user-id header.'
        });
      }

      const { scheduleId } = req.params;

      // Verify schedule belongs to this user
      const config = await ScheduleConfig.findOne({ scheduleId, userId });
      if (!config) {
        return res.status(404).json({
          error: 'Schedule not found',
          message: `No schedule found with ID: ${scheduleId}`
        });
      }

      const client = await getTemporalClient();
      const handle = client.schedule.getHandle(scheduleId);

      await handle.pause();

      // Update MongoDB config
      await ScheduleConfig.findOneAndUpdate(
        { scheduleId, userId },
        { isActive: false }
      );

      logger.info('Paused schedule', { userId, scheduleId });

      res.json({
        userId,
        scheduleId,
        status: 'paused',
        message: 'Schedule paused successfully'
      });

    } catch (error) {
      logger.error('Failed to pause schedule', { error });
      res.status(500).json({
        error: 'Failed to pause schedule',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * POST /api/schedules/:scheduleId/unpause
   * Resume a paused schedule
   */
  async unpauseSchedule(req: Request, res: Response) {
    try {
      // Extract userId from auth or header
      const userId = (req as any).user?.id || req.headers['x-user-id'] as string;

      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'userId is required. Provide via authentication or x-user-id header.'
        });
      }

      const { scheduleId } = req.params;

      // Verify schedule belongs to this user
      const config = await ScheduleConfig.findOne({ scheduleId, userId });
      if (!config) {
        return res.status(404).json({
          error: 'Schedule not found',
          message: `No schedule found with ID: ${scheduleId}`
        });
      }

      const client = await getTemporalClient();
      const handle = client.schedule.getHandle(scheduleId);

      await handle.unpause();

      // Update MongoDB config
      await ScheduleConfig.findOneAndUpdate(
        { scheduleId, userId },
        { isActive: true }
      );

      logger.info('Unpaused schedule', { userId, scheduleId });

      res.json({
        userId,
        scheduleId,
        status: 'active',
        message: 'Schedule resumed successfully'
      });

    } catch (error) {
      logger.error('Failed to unpause schedule', { error });
      res.status(500).json({
        error: 'Failed to unpause schedule',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * PATCH /api/schedules/:scheduleId
   * Update schedule configuration
   */
  async updateSchedule(req: Request, res: Response) {
    try {
      // Extract userId from auth or header
      const userId = (req as any).user?.id || req.headers['x-user-id'] as string;

      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'userId is required. Provide via authentication or x-user-id header.'
        });
      }

      const { scheduleId } = req.params;
      const { name, description, searchQuery, maxResults, afterDate } = req.body;

      // Update MongoDB configuration
      const updateData: any = {};
      if (name) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (searchQuery) updateData.searchQuery = searchQuery;
      if (maxResults) updateData.maxResults = maxResults;
      if (afterDate !== undefined) updateData.afterDate = afterDate ? new Date(afterDate) : null;

      const config = await ScheduleConfig.findOneAndUpdate(
        { scheduleId, userId },
        updateData,
        { new: true }
      );

      if (!config) {
        return res.status(404).json({
          error: 'Schedule not found',
          message: `No schedule found with ID: ${scheduleId}`
        });
      }

      logger.info('Updated schedule configuration', { userId, scheduleId, updateData });

      res.json({
        userId,
        scheduleId,
        name: config.name,
        description: config.description,
        searchQuery: config.searchQuery,
        maxResults: config.maxResults,
        afterDate: config.afterDate,
        message: 'Schedule configuration updated successfully'
      });

    } catch (error) {
      logger.error('Failed to update schedule', { error });
      res.status(500).json({
        error: 'Failed to update schedule',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}
