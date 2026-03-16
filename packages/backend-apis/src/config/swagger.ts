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
      { name: 'Gmail', description: 'Gmail OAuth and real-time synchronization' },
      { name: 'Emails', description: 'Financial email storage and searching' },
      { name: 'Workflows', description: 'Temporal background processing control' },
      { name: 'System', description: 'Platform health and diagnostics' },
    ],
    servers: [
      {
        url: `http://localhost:${config.port}/api`,
        description: 'Local development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      responses: {
        UnauthorizedError: {
          description: 'Access token is missing or invalid',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'unauthorized' },
                  message: { type: 'string', example: 'Missing or invalid token' },
                },
              },
            },
          },
        },
        NotFoundError: {
          description: 'The requested resource was not found',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'not_found' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
        ServerError: {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'server_error' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  },
  // Path to the API docs
  apis: [
    './src/routes/*.ts',
    './src/controllers/*.ts',
    './src/models/*.ts',
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
