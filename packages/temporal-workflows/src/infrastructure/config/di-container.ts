/**
 * Dependency Injection Container Configuration
 * Wires all Clean Architecture layers together
 * Enables runtime provider selection
 */
import 'reflect-metadata';
import { container, DependencyContainer } from 'tsyringe';
import { OAuth2Client } from 'google-auth-library';
import { Connection } from 'mongoose';

// Layer 2 - Application Interfaces (Gateways)
import { IEmailGateway } from '../../application/interfaces/gateways/iemail-gateway';
import { IAIGateway, ITransactionExtractorGateway } from '../../application/interfaces/gateways/iai-gateway';

// Layer 2 - Application Interfaces (Repositories)
import { ITransactionRepository } from '../../application/interfaces/repositories/itransaction-repository';
import { IEmailRepository } from '../../application/interfaces/repositories/iemail-repository';
import { IPatternRepository } from '../../application/interfaces/repositories/ipattern-repository';

// Layer 3 & 4 - Gmail Implementations
import { GmailGateway } from '../external/email/gmail/gmail.gateway';
import { GmailMapper } from '../external/email/gmail/gmail.mapper';

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

// Layer 2 - Use Cases
import { ProcessEmailUseCase } from '../../application/use-cases/process-email/process-email.use-case';

export interface DIContainerConfig {
  emailProvider: 'gmail';  // Can add 'outlook' later
  aiProvider: 'openai' | 'ollama';
  mongoConnection: Connection;

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

/**
 * Central Dependency Injection Container
 * Follows Clean Architecture principles - wires layers together without violating dependency rule
 */
export class DIContainer {
  private static instance: DependencyContainer;

  /**
   * Setup DI Container with provider configuration
   * This is where all Clean Architecture layers get connected
   */
  static setup(config: DIContainerConfig): DependencyContainer {
    if (this.instance) {
      return this.instance;
    }

    // Register MongoDB connection (Framework Layer)
    container.register<Connection>('MongoConnection', {
      useValue: config.mongoConnection
    });

    // ==================== EMAIL GATEWAY REGISTRATION ====================
    if (config.emailProvider === 'gmail') {
      // Register Gmail OAuth2 Client
      container.register<OAuth2Client>('OAuth2Client', {
        useValue: config.gmailOAuth2Client!
      });

      // Register Gmail Mapper
      container.register('GmailMapper', {
        useClass: GmailMapper
      });

      // Register Gmail Gateway as IEmailGateway implementation
      container.register<IEmailGateway>('IEmailGateway', {
        useClass: GmailGateway
      });
    }
    // Future: Add Outlook provider registration here

    // ==================== AI GATEWAY REGISTRATION ====================
    if (config.aiProvider === 'openai') {
      // Register OpenAI Configuration
      container.register('OpenAIConfig', {
        useValue: {
          apiKey: config.openaiApiKey!,
          model: config.openaiModel || 'gpt-4o-mini',
          endpoint: config.openaiEndpoint
        }
      });

      // Register OpenAI Gateway as IAIGateway implementation
      container.register<IAIGateway>('IAIGateway', {
        useClass: OpenAIGateway
      });

      // Register OpenAI Transaction Extractor
      container.register<ITransactionExtractorGateway>('ITransactionExtractorGateway', {
        useClass: OpenAITransactionExtractorGateway
      });
    } else if (config.aiProvider === 'ollama') {
      // Register Ollama Configuration
      container.register('OllamaConfig', {
        useValue: {
          endpoint: config.ollamaEndpoint!,
          model: config.ollamaModel || 'phi3:mini'
        }
      });

      // Register Ollama Gateway as IAIGateway implementation
      container.register<IAIGateway>('IAIGateway', {
        useClass: OllamaGateway
      });

      // Register Ollama Transaction Extractor
      container.register<ITransactionExtractorGateway>('ITransactionExtractorGateway', {
        useClass: OllamaTransactionExtractorGateway
      });
    }

    // ==================== REPOSITORY REGISTRATION ====================
    // Register MongoDB repositories as interface implementations
    container.register<ITransactionRepository>('ITransactionRepository', {
      useClass: MongoDBTransactionRepository
    });

    container.register<IEmailRepository>('IEmailRepository', {
      useClass: MongoDBEmailRepository
    });

    container.register<IPatternRepository>('IPatternRepository', {
      useClass: MongoDBPatternRepository
    });

    // ==================== USE CASE REGISTRATION ====================
    // Register application use cases
    container.register(ProcessEmailUseCase, {
      useClass: ProcessEmailUseCase
    });

    this.instance = container;
    return this.instance;
  }

  /**
   * Get the configured DI container instance
   */
  static getContainer(): DependencyContainer {
    if (!this.instance) {
      throw new Error('DI Container not initialized. Call setup() first.');
    }
    return this.instance;
  }

  /**
   * Reset the container (useful for testing or reinitialization)
   */
  static reset(): void {
    container.reset();
    this.instance = undefined as any;
  }

  /**
   * Resolve a dependency from the container
   */
  static resolve<T>(token: string | { new(...args: any[]): T }): T {
    return this.getContainer().resolve(token as any);
  }
}
