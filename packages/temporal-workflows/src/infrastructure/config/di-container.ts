/**
 * Dependency Injection Container Configuration
 * Wires all Clean Architecture layers together.
 * Supports runtime switching between MongoDB and Prisma (Supabase).
 *
 * DB_PROVIDER=mongodb  → MongoDBXxxRepository (default)
 * DB_PROVIDER=prisma   → PrismaXxxRepository (Supabase)
 */
import 'reflect-metadata';
import { container, DependencyContainer } from 'tsyringe';
import { OAuth2Client } from 'google-auth-library';
import { Connection } from 'mongoose';
import { PrismaClient } from '@prisma/client';

// Layer 2 - Application Interfaces (Gateways)
import { IEmailGateway } from '../../application/interfaces/gateways/iemail-gateway';
import { IAIGateway, ITransactionExtractorGateway } from '../../application/interfaces/gateways/iai-gateway';
import { IMailSyncGateway } from '../../application/interfaces/gateways/imail-sync-gateway';

// Layer 2 - Application Interfaces (Repositories)
import { ITransactionRepository } from '../../application/interfaces/repositories/itransaction-repository';
import { IEmailRepository } from '../../application/interfaces/repositories/iemail-repository';
import { IPatternRepository } from '../../application/interfaces/repositories/ipattern-repository';
import { IPipelineStepRepository } from '../../application/interfaces/repositories/ipipeline-step-repository';

// Layer 3 & 4 - Gmail Implementations
import { GmailGateway } from '../external/email/gmail/gmail.gateway';
import { GmailMapper } from '../external/email/gmail/gmail.mapper';
import { GmailSyncGateway } from '../external/email/gmail/gmail-sync.gateway';

// Layer 3 & 4 - OpenAI Implementations
import { OpenAIGateway } from '../external/ai/openai/openai.gateway';
import { OpenAITransactionExtractorGateway } from '../external/ai/openai/openai-transaction-extractor.gateway';

// Layer 3 & 4 - Ollama Implementations
import { OllamaGateway } from '../external/ai/ollama/ollama.gateway';
import { OllamaTransactionExtractorGateway } from '../external/ai/ollama/ollama-transaction-extractor.gateway';

// Layer 3 - MongoDB Repository Implementations
import { MongoDBTransactionRepository } from '../persistence/mongodb/repositories/transaction.repository';
import { MongoDBEmailRepository } from '../persistence/mongodb/repositories/email.repository';
import { MongoDBPatternRepository } from '../persistence/mongodb/repositories/pattern.repository';
import { MongoDBPipelineStepRepository } from '../persistence/mongodb/repositories/pipeline-step.repository';

// Layer 3 - Prisma Repository Implementations
import { PrismaTransactionRepository } from '../persistence/prisma/repositories/transaction.repository';
import { PrismaEmailRepository } from '../persistence/prisma/repositories/email.repository';
import { PrismaPatternRepository } from '../persistence/prisma/repositories/pattern.repository';
import { PrismaPipelineStepRepository } from '../persistence/prisma/repositories/pipeline-step.repository';

// Layer 2 - Use Cases
import { ProcessEmailUseCase } from '../../application/use-cases/process-email/process-email.use-case';

export interface DIContainerConfig {
  emailProvider: 'gmail';        // 'outlook' can be added later
  aiProvider: 'openai' | 'ollama';
  dbProvider: 'mongodb' | 'prisma';

  // MongoDB (required when dbProvider === 'mongodb')
  mongoConnection?: Connection;

  // Prisma (required when dbProvider === 'prisma')
  prismaClient?: PrismaClient;

  // Gmail config
  gmailOAuth2Client?: OAuth2Client;

  // OpenAI config
  openaiApiKey?: string;
  openaiModel?: string;
  openaiEndpoint?: string;

  // Ollama config
  ollamaEndpoint?: string;
  ollamaModel?: string;
}

export class DIContainer {
  private static instance: DependencyContainer;

  static setup(config: DIContainerConfig): DependencyContainer {
    if (this.instance) {
      return this.instance;
    }

    // ==================== EMAIL GATEWAY ====================
    if (config.emailProvider === 'gmail') {
      container.register<OAuth2Client>('OAuth2Client', { useValue: config.gmailOAuth2Client! });
      container.register('GmailMapper', { useClass: GmailMapper });
      container.register<IEmailGateway>('IEmailGateway', { useClass: GmailGateway });
      container.register<IMailSyncGateway>('IMailSyncGateway', { useClass: GmailSyncGateway });
    }

    // ==================== AI GATEWAY ====================
    if (config.aiProvider === 'openai') {
      container.register('OpenAIConfig', {
        useValue: {
          apiKey: config.openaiApiKey!,
          model: config.openaiModel || 'gpt-4o-mini',
          endpoint: config.openaiEndpoint,
        },
      });
      container.register<IAIGateway>('IAIGateway', { useClass: OpenAIGateway });
      container.register<ITransactionExtractorGateway>('ITransactionExtractorGateway', {
        useClass: OpenAITransactionExtractorGateway,
      });
    } else if (config.aiProvider === 'ollama') {
      container.register('OllamaConfig', {
        useValue: {
          endpoint: config.ollamaEndpoint!,
          model: config.ollamaModel || 'phi3:mini',
        },
      });
      container.register<IAIGateway>('IAIGateway', { useClass: OllamaGateway });
      container.register<ITransactionExtractorGateway>('ITransactionExtractorGateway', {
        useClass: OllamaTransactionExtractorGateway,
      });
    }

    // ==================== REPOSITORIES ====================
    if (config.dbProvider === 'prisma') {
      container.register<PrismaClient>('PrismaClient', { useValue: config.prismaClient! });
      container.register<ITransactionRepository>('ITransactionRepository', { useClass: PrismaTransactionRepository });
      container.register<IEmailRepository>('IEmailRepository', { useClass: PrismaEmailRepository });
      container.register<IPatternRepository>('IPatternRepository', { useClass: PrismaPatternRepository });
      container.register<IPipelineStepRepository>('IPipelineStepRepository', { useClass: PrismaPipelineStepRepository });
    } else {
      container.register<Connection>('MongoConnection', { useValue: config.mongoConnection! });
      container.register<ITransactionRepository>('ITransactionRepository', { useClass: MongoDBTransactionRepository });
      container.register<IEmailRepository>('IEmailRepository', { useClass: MongoDBEmailRepository });
      container.register<IPatternRepository>('IPatternRepository', { useClass: MongoDBPatternRepository });
      container.register<IPipelineStepRepository>('IPipelineStepRepository', { useClass: MongoDBPipelineStepRepository });
    }

    // ==================== USE CASES ====================
    container.register(ProcessEmailUseCase, { useClass: ProcessEmailUseCase });

    this.instance = container;
    return this.instance;
  }

  static getContainer(): DependencyContainer {
    if (!this.instance) {
      throw new Error('DI Container not initialized. Call setup() first.');
    }
    return this.instance;
  }

  static reset(): void {
    container.reset();
    this.instance = undefined as any;
  }

  static resolve<T>(token: string | { new(...args: any[]): T }): T {
    return this.getContainer().resolve(token as any);
  }
}
