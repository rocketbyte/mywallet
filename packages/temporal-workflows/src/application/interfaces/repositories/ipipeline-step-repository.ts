import { PipelineStepConfig } from '../../../shared/types';

export interface IPipelineStepRepository {
  /**
   * Get a single active step by its key
   * Throws PipelineStepNotFoundError if not found
   * Throws PipelineStepInactiveError if found but inactive
   */
  getActiveStep(stepKey: string): Promise<PipelineStepConfig>;

  /**
   * Get all steps ordered by `order` field
   */
  getAllSteps(): Promise<PipelineStepConfig[]>;

  /**
   * Upsert a pipeline step (used by API and seed script)
   */
  upsert(data: Partial<PipelineStepConfig> & { stepKey: string; updatedBy?: string }): Promise<PipelineStepConfig>;
}

export class PipelineStepNotFoundError extends Error {
  constructor(stepKey: string) {
    super(`Pipeline step not found: ${stepKey}`);
    this.name = 'PipelineStepNotFoundError';
  }
}

export class PipelineStepInactiveError extends Error {
  constructor(stepKey: string) {
    super(`Pipeline step is inactive: ${stepKey}`);
    this.name = 'PipelineStepInactiveError';
  }
}
