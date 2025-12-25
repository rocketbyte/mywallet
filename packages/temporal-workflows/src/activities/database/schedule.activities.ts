import { Context } from '@temporalio/activity';
import { Connection } from 'mongoose';
import { ScheduleConfig } from '../../models';

export const createScheduleActivities = (mongoConnection: Connection) => {
  return {
    /**
     * Get schedule configuration
     */
    async getScheduleConfig(scheduleId: string) {
      const config = await ScheduleConfig.findOne({ scheduleId });
      return config ? config.toObject() : null;
    },

    /**
     * Update schedule statistics
     */
    async updateScheduleStats(input: {
      scheduleId: string;
      emailsFetched: number;
      emailsProcessed: number;
      errors: number;
      status: 'success' | 'failure';
    }): Promise<void> {
      Context.current().heartbeat();

      await ScheduleConfig.findOneAndUpdate(
        { scheduleId: input.scheduleId },
        {
          $inc: {
            totalRuns: 1,
            totalEmailsFetched: input.emailsFetched,
            totalEmailsProcessed: input.emailsProcessed,
            totalErrors: input.errors
          },
          lastRunAt: new Date(),
          lastRunStatus: input.status
        }
      );

      console.log(`Schedule stats updated: ${input.scheduleId}`);
    },

    /**
     * Create schedule configuration
     */
    async createScheduleConfig(input: {
      scheduleId: string;
      name: string;
      description?: string;
      searchQuery: string;
      cronExpression: string;
      maxResults: number;
      afterDate?: Date;
    }) {
      const config = new ScheduleConfig({
        scheduleId: input.scheduleId,
        name: input.name,
        description: input.description,
        searchQuery: input.searchQuery,
        cronExpression: input.cronExpression,
        maxResults: input.maxResults,
        afterDate: input.afterDate,
        isActive: true,
        skipProcessed: true
      });

      await config.save();

      return config.toObject();
    },

    /**
     * Delete schedule configuration
     */
    async deleteScheduleConfig(scheduleId: string): Promise<void> {
      await ScheduleConfig.findOneAndDelete({ scheduleId });
      console.log(`Schedule config deleted: ${scheduleId}`);
    },

    /**
     * Get all schedule configurations
     */
    async getAllScheduleConfigs() {
      const configs = await ScheduleConfig.find().sort({ createdAt: -1 });
      return configs.map(c => c.toObject());
    }
  };
};

export type ScheduleActivities = ReturnType<typeof createScheduleActivities>;
