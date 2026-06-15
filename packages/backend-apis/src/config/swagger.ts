import path from 'path';
import swaggerJsdoc from 'swagger-jsdoc';
import { config } from './environment';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'MyWallet API',
      version: '1.0.0',
      description: `
Welcome to the **MyWallet Developer Hub**. 

This API provides powerful tools to interact with your financial data, automate transaction extraction from Gmail, and monitor your wallet's health in real-time.

### Key Capabilities:
*  **Smart Sync**: Proactive Gmail OAuth token management.
*  **Auto-Matching**: Real-time webhook processing for bank notifications.
*  **Financial Insights**: Detailed email statistics and filtered transaction history.
*  **Temporal Orchestration**: Durable, reliable background workflows.
      `,
      contact: {
        name: 'MyWallet Developer Team',
        url: 'https://github.com/rocketbyte/mywallet',
      },
    },
    tags: [
      { name: 'Users', description: 'Authenticated user identity and linked IDPs' },
      { name: 'Chat', description: 'Streaming chat with the Mintly agent (tool-driven)' },
      { name: 'Gmail', description: 'Gmail OAuth and real-time synchronization' },
      { name: 'Emails', description: 'Financial email storage and searching' },
      { name: 'Pipeline', description: 'AI pipeline — manage prompts and manually trigger transaction extraction' },
      { name: 'Workflows', description: 'Temporal background processing — trigger and monitor runs' },
      { name: 'System', description: 'Platform health and diagnostics' },
    ],
    servers: [
      {
        url: 'https://wallet.rotbyte.com/api',
        description: 'Production server',
      },
      {
        url: `http://localhost:${config.port}/api`,
        description: 'Local development server',
      },
    ],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Firebase ID token. Obtain on the client via the Firebase Auth SDK and send as `Authorization: Bearer <token>`.',
        },
      },
      parameters: {
        UserId: {
          in: 'header',
          name: 'x-user-id',
          required: false,
          schema: { type: 'string' },
          description: 'Dev-only override (active when AUTH_BYPASS=true). Ignored when Firebase auth is enforced.',
          example: 'user_123',
        },
        LimitQuery: {
          in: 'query',
          name: 'limit',
          schema: { type: 'integer', default: 50, minimum: 1, maximum: 200 },
          description: 'Maximum number of results to return.',
        },
        OffsetQuery: {
          in: 'query',
          name: 'offset',
          schema: { type: 'integer', default: 0, minimum: 0 },
          description: 'Number of results to skip (for pagination).',
        },
      },
      schemas: {
        Pagination: {
          type: 'object',
          properties: {
            total: { type: 'integer', description: 'Total number of matching records.', example: 142 },
            limit: { type: 'integer', example: 50 },
            offset: { type: 'integer', example: 0 },
            hasMore: { type: 'boolean', example: true },
          },
        },
        Email: {
          type: 'object',
          properties: {
            userId: { type: 'string', example: 'user_123' },
            emailId: { type: 'string', description: 'Gmail message ID.', example: '18f3c2a1b9e4d7f0' },
            threadId: { type: 'string', example: '18f3c2a1b9e4d7f0' },
            from: { type: 'string', example: 'alertas@chase.com' },
            to: { type: 'string', example: 'user@gmail.com' },
            subject: { type: 'string', example: 'Usaste tu tarjeta de credito' },
            date: { type: 'string', format: 'date-time' },
            snippet: { type: 'string', example: 'Hola, realizaste un cargo de $45.00...' },
            isProcessed: { type: 'boolean', example: true },
            processedAt: { type: 'string', format: 'date-time', nullable: true },
            matchedPatternName: { type: 'string', example: 'Chase Credit Card', nullable: true },
            transactionId: { type: 'string', nullable: true },
            confidence: { type: 'number', minimum: 0, maximum: 1, example: 0.97 },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        PipelineStep: {
          type: 'object',
          properties: {
            stepKey: { type: 'string', enum: ['classify_email', 'extract_transaction', 'store_transaction'], example: 'classify_email' },
            name: { type: 'string', example: 'Classify Email' },
            description: { type: 'string', example: 'Determines whether an email is a bank transaction notification.' },
            order: { type: 'integer', example: 1 },
            model: { type: 'string', example: 'qwen3:4b' },
            temperature: { type: 'number', minimum: 0, maximum: 2, example: 0.1 },
            maxTokens: { type: 'integer', example: 300 },
            isActive: { type: 'boolean', example: true },
            version: { type: 'integer', example: 1 },
            systemPrompt: { type: 'string', description: 'System prompt sent to the LLM.' },
            userPromptTemplate: { type: 'string', description: 'User prompt template. Supports {{email_from}}, {{email_subject}}, {{email_body}}, {{email_date}}, {{transaction_type}}.' },
            updatedBy: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Transaction: {
          type: 'object',
          properties: {
            userId: { type: 'string', example: 'user_123' },
            emailId: { type: 'string', example: '18f3c2a1b9e4d7f0' },
            merchant: { type: 'string', example: 'SUPERMERCADO NACIONAL' },
            amount: { type: 'number', example: 2450.00 },
            currency: { type: 'string', example: 'DOP' },
            transactionDate: { type: 'string', format: 'date-time' },
            transactionType: { type: 'string', enum: ['debit', 'credit'], example: 'debit' },
            bankName: { type: 'string', example: 'Banco Popular Dominicano', nullable: true },
            accountLast4: { type: 'string', example: '4521', nullable: true },
            referenceNumber: { type: 'string', nullable: true },
            category: { type: 'string', enum: ['Food', 'Transport', 'Shopping', 'Bills', 'Entertainment', 'Healthcare', 'Travel', 'Education', 'Personal', 'Other'], example: 'Shopping' },
            description: { type: 'string', nullable: true },
            confidence: { type: 'number', minimum: 0, maximum: 1, example: 0.95 },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        PipelineRunResponse: {
          type: 'object',
          properties: {
            workflowId: { type: 'string', example: 'pipeline-manual-18f3c2a1b9e4d7f0-1711234567' },
            runId: { type: 'string', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
            emailId: { type: 'string', example: '18f3c2a1b9e4d7f0' },
            status: { type: 'string', example: 'started' },
          },
        },
        WorkflowStatus: {
          type: 'object',
          properties: {
            workflowId: { type: 'string', example: 'email-processing-user_123-1711234567' },
            runId: { type: 'string', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
            status: { type: 'string', example: 'COMPLETED', enum: ['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'TERMINATED', 'CONTINUED_AS_NEW', 'TIMED_OUT'] },
            startTime: { type: 'string', format: 'date-time' },
            closeTime: { type: 'string', format: 'date-time', nullable: true },
            result: { type: 'object', nullable: true, description: 'Workflow result payload when status is COMPLETED.' },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Failed to fetch emails' },
            message: { type: 'string', example: 'Detailed error description.' },
          },
        },
      },
      responses: {
        BadRequestError: {
          description: 'The request body or parameters were invalid.',
          content: {
            'application/json': {
              schema: { '$ref': '#/components/schemas/ErrorResponse' },
              example: { error: 'Unsupported language. Expected one of: en, es' },
            },
          },
        },
        UnauthorizedError: {
          description: 'Missing or invalid Firebase ID token.',
          content: {
            'application/json': {
              schema: { '$ref': '#/components/schemas/ErrorResponse' },
              example: { error: 'Unauthorized', message: 'Invalid or expired token' },
            },
          },
        },
        NotFoundError: {
          description: 'The requested resource was not found.',
          content: {
            'application/json': {
              schema: { '$ref': '#/components/schemas/ErrorResponse' },
              example: { error: 'not_found', message: 'No email found with ID: abc123' },
            },
          },
        },
        ServerError: {
          description: 'Internal server error.',
          content: {
            'application/json': {
              schema: { '$ref': '#/components/schemas/ErrorResponse' },
              example: { error: 'server_error', message: 'An unexpected error occurred.' },
            },
          },
        },
      },
    },
  },
  // Absolute paths — resolved from this file's location so they work
  // regardless of the process CWD (local dev, Docker, CI, etc.)
  apis: [
    path.join(__dirname, '../routes/*.ts'),
    path.join(__dirname, '../routes/*.js'),
    path.join(__dirname, '../controllers/*.ts'),
    path.join(__dirname, '../controllers/*.js'),
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
