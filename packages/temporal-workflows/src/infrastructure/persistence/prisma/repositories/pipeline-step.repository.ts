/**
 * Prisma Pipeline Step Repository (Layer 3 - Interface Adapters)
 * Implements PipelineStepRepositoryInterface — drop-in replacement for MongoDBPipelineStepRepository.
 */
import { injectable, inject } from 'tsyringe';
import { PrismaClient } from '@prisma/client';
import {
  PipelineStepRepositoryInterface,
  PipelineStepNotFoundError,
  PipelineStepInactiveError,
} from '../../../../application/interfaces/repositories/ipipeline-step-repository';
import { PipelineStepConfig } from '../../../../shared/types';

@injectable()
export class PrismaPipelineStepRepository implements PipelineStepRepositoryInterface {
  constructor(
    @inject('PrismaClient') private prisma: PrismaClient
  ) {}

  async getActiveStep(stepKey: string): Promise<PipelineStepConfig> {
    const record = await this.prisma.pipelineStep.findUnique({ where: { stepKey } });

    if (!record) throw new PipelineStepNotFoundError(stepKey);
    if (!record.isActive) throw new PipelineStepInactiveError(stepKey);

    return this.toConfig(record);
  }

  async getAllSteps(): Promise<PipelineStepConfig[]> {
    const records = await this.prisma.pipelineStep.findMany({
      orderBy: { order: 'asc' },
    });
    return records.map((r: any) => this.toConfig(r));
  }

  async upsert(
    data: Partial<PipelineStepConfig> & { stepKey: string; updatedBy?: string }
  ): Promise<PipelineStepConfig> {
    const { stepKey, updatedBy, ...fields } = data;

    const record = await this.prisma.pipelineStep.upsert({
      where: { stepKey },
      create: {
        stepKey,
        name: fields.name || stepKey,
        description: (fields as any).description || '',
        order: fields.order || 0,
        systemPrompt: fields.systemPrompt || '',
        userPromptTemplate: fields.userPromptTemplate || '',
        model: fields.model || 'gpt-4o-mini',
        temperature: fields.temperature ?? 0.1,
        maxTokens: fields.maxTokens || 500,
        isActive: fields.isActive ?? true,
        version: 1,
        updatedBy,
      },
      update: {
        ...fields,
        updatedBy,
        version: { increment: 1 },
      },
    });

    return this.toConfig(record);
  }

  private toConfig(record: any): PipelineStepConfig {
    return {
      stepKey: record.stepKey,
      name: record.name,
      order: record.order,
      systemPrompt: record.systemPrompt,
      userPromptTemplate: record.userPromptTemplate,
      model: record.model,
      temperature: record.temperature,
      maxTokens: record.maxTokens,
      isActive: record.isActive,
      version: record.version,
    };
  }
}
