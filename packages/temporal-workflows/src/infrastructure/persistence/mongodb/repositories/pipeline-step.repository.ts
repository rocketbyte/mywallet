import { injectable } from 'tsyringe';
import { PipelineStep } from '../../../../models/pipeline-step.model';
import {
  IPipelineStepRepository,
  PipelineStepNotFoundError,
  PipelineStepInactiveError
} from '../../../../application/interfaces/repositories/ipipeline-step-repository';
import { PipelineStepConfig } from '../../../../shared/types';

@injectable()
export class MongoDBPipelineStepRepository implements IPipelineStepRepository {
  async getActiveStep(stepKey: string): Promise<PipelineStepConfig> {
    const doc = await PipelineStep.findOne({ stepKey }).lean();

    if (!doc) {
      throw new PipelineStepNotFoundError(stepKey);
    }

    if (!doc.isActive) {
      throw new PipelineStepInactiveError(stepKey);
    }

    return this.toConfig(doc);
  }

  async getAllSteps(): Promise<PipelineStepConfig[]> {
    const docs = await PipelineStep.find().sort({ order: 1 }).lean();
    return docs.map(d => this.toConfig(d));
  }

  async upsert(
    data: Partial<PipelineStepConfig> & { stepKey: string; updatedBy?: string }
  ): Promise<PipelineStepConfig> {
    const { stepKey, updatedBy, ...fields } = data;

    const doc = await PipelineStep.findOneAndUpdate(
      { stepKey },
      {
        $set: { ...fields, updatedBy },
        $inc: { version: 1 }
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();

    return this.toConfig(doc!);
  }

  private toConfig(doc: any): PipelineStepConfig {
    return {
      stepKey: doc.stepKey,
      name: doc.name,
      order: doc.order,
      systemPrompt: doc.systemPrompt,
      userPromptTemplate: doc.userPromptTemplate,
      model: doc.model,
      temperature: doc.temperature,
      maxTokens: doc.maxTokens,
      isActive: doc.isActive,
      version: doc.version
    };
  }
}
