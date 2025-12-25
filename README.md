# MyWallet - Expense Tracking with Temporal

An intelligent expense tracking system that uses Temporal workflows to orchestrate Gmail email processing, OpenAI-powered transaction extraction, and MongoDB storage.

## Features

- 📧 **Gmail Integration**: Automatically fetch and process bank transaction emails
- 🔔 **Real-time Gmail Sync** ✨ NEW: Push notifications via Google Cloud Pub/Sub for instant email syncing
- ⏰ **Scheduled Processing**: Temporal cron runs every minute to process new emails
- 🤖 **AI-Powered Extraction**: Use OpenAI to extract transaction details from email text
- 🔄 **Durable Workflows**: Temporal orchestrates all operations with automatic retries
- 💾 **MongoDB Storage**: Persist transactions with powerful querying capabilities
- 🎯 **Pattern Matching**: Configurable email patterns for different banks
- 📊 **REST API**: Query transactions, emails, and manage schedules via HTTP endpoints
- 🔍 **Email Query API**: Search and filter stored emails with pagination
- 🛡️ **Duplicate Prevention**: Emails are deduplicated by Gmail message ID
- 🔐 **OAuth Token Management**: Automatic refresh token handling for Gmail API

## Architecture

```
┌─────────────────┐
│   Express API   │ ← HTTP Requests
└────────┬────────┘
         │ Start Workflow
         ▼
┌─────────────────┐
│  Temporal Server│
└────────┬────────┘
         │ Execute
         ▼
┌─────────────────┐      ┌─────────────┐      ┌─────────────┐
│  Temporal Worker│─────▶│  Gmail API  │      │  OpenAI API │
└────────┬────────┘      └─────────────┘      └─────────────┘
         │                      ▲                      ▲
         │                      │                      │
         └──────────────────────┴──────────────────────┘
         │
         ▼
┌─────────────────┐
│    MongoDB      │
└─────────────────┘
```

## Project Structure

```
mywallet/
├── packages/
│   ├── backend-apis/          # Express REST API
│   │   └── src/
│   │       ├── config/        # Configuration
│   │       ├── controllers/   # Request handlers
│   │       ├── routes/        # API routes
│   │       └── middleware/    # Express middleware
│   │
│   ├── temporal-worker/       # Worker process
│   │   └── src/
│   │       ├── config/        # Worker configuration
│   │       └── worker.ts      # Main worker file
│   │
│   └── temporal-workflows/    # Workflows + Activities
│       └── src/
│           ├── workflows/     # Temporal workflows
│           ├── activities/    # Gmail, OpenAI, MongoDB activities
│           ├── models/        # MongoDB schemas
│           └── shared/        # Types and constants
│
├── scripts/                   # Utility scripts
├── docker-compose.yml         # Service orchestration
└── README.md
```

## Prerequisites

- Node.js 20+
- Docker & Docker Compose
- Gmail account with API access
- OpenAI API key

## 🚀 Quick Start

**📖 For detailed setup instructions, see [HOW_TO_RUN.md](./HOW_TO_RUN.md)**

**🔔 For Gmail Real-time Sync setup, see [GMAIL_SYNC_IMPLEMENTATION.md](./GMAIL_SYNC_IMPLEMENTATION.md)**

### Quick Summary:

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your credentials

# 3. Start infrastructure
docker-compose up -d

# 4. Seed email patterns
npm run seed:patterns

# 5. Start worker (Terminal 1)
cd packages/temporal-worker && npm run dev

# 6. Start API server (Terminal 2)
cd packages/backend-apis && npm run dev

# 7. Create a schedule to process emails every minute
curl -X POST http://localhost:3000/api/schedules/email-processing \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Credit Card Emails",
    "searchQuery": "subject:\"Usaste tu tarjeta de credito\"",
    "cronExpression": "* * * * *"
  }'
```

---

## Getting Started

### 1. Clone and Install Dependencies

```bash
# Navigate to project
cd mywallet

# Install dependencies
npm install
```

**Note**: If you encounter "ENOSPC: no space left on device" errors, free up disk space before continuing.

### 2. Set Up Environment Variables

```bash
# Copy the example file
cp .env.example .env

# Edit .env and fill in your credentials
nano .env
```

Required environment variables:
```env
TEMPORAL_ADDRESS=localhost:7233
MONGODB_URI=mongodb://admin:admin123@localhost:27017/mywallet?authSource=admin
GMAIL_CLIENT_ID=your-client-id.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=your-client-secret
GMAIL_REFRESH_TOKEN=your-refresh-token
OPENAI_API_KEY=sk-your-openai-api-key
```

### 3. Set Up Gmail OAuth Credentials

Follow the [Gmail OAuth Setup Guide](#gmail-oauth-setup) below to:
1. Create a Google Cloud Project
2. Enable Gmail API
3. Create OAuth 2.0 credentials
4. Generate a refresh token

### 4. Start Infrastructure with Docker Compose

```bash
# Start all services (Temporal, MongoDB, PostgreSQL, Temporal UI)
docker-compose up -d

# Check service status
docker-compose ps

# View logs
docker-compose logs -f
```

Services will be available at:
- Temporal UI: http://localhost:8080
- MongoDB: localhost:27017
- Temporal gRPC: localhost:7233

### 5. Seed Email Patterns

```bash
# Seed Chase bank patterns to MongoDB
npm run seed:patterns
```

### 6. Start the Application

**Option A: Run Locally (Development)**

```bash
# Terminal 1: Start the worker
npm run dev:worker

# Terminal 2: Start the API
npm run dev:api
```

**Option B: Run with Docker (Production-like)**

Update `docker-compose.yml` to uncomment the API and Worker services, then:

```bash
docker-compose up -d
```

### 7. Test the API

```bash
# Health check
curl http://localhost:3000/api/health

# Start email processing workflow
curl -X POST http://localhost:3000/api/workflows/email-processing \
  -H "Content-Type: application/json" \
  -d '{
    "searchQuery": "from:no-reply@chase.com subject:transaction",
    "maxResults": 10,
    "afterDate": "2024-01-01"
  }'

# Get workflow status (replace with actual workflowId)
curl http://localhost:3000/api/workflows/email-processing-1234567890
```

## Gmail OAuth Setup

### Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Click "Create Project"
3. Name: "MyWallet Expense Tracker"
4. Click "Create"

### Step 2: Enable Gmail API

1. Navigate to "APIs & Services" > "Library"
2. Search for "Gmail API"
3. Click "Enable"

### Step 3: Configure OAuth Consent Screen

1. Go to "APIs & Services" > "OAuth consent screen"
2. Choose "External" user type
3. Fill in application information:
   - App name: "MyWallet"
   - User support email: Your email
   - Developer contact: Your email
4. Click "Save and Continue"
5. Add scopes:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.modify`
6. Add test users: Your Gmail address
7. Click "Save and Continue"

### Step 4: Create OAuth 2.0 Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth 2.0 Client ID"
3. Application type: "Desktop app"
4. Name: "MyWallet Desktop Client"
5. Click "Create"
6. Download the JSON file
7. Copy `client_id` and `client_secret` to your `.env` file

### Step 5: Generate Refresh Token

```bash
# Run the OAuth setup helper (requires implementation)
npm run setup:gmail
```

This will:
1. Open your browser for Google sign-in
2. Request permissions for Gmail access
3. Generate a refresh token
4. Display the token in your terminal

Copy the refresh token to your `.env` file:
```env
GMAIL_REFRESH_TOKEN=your-long-refresh-token-here
```

## API Endpoints

### Health Check
```
GET /api/health
GET /api/health/deep
```

### Email Query APIs (NEW)

**Get All Emails**
```
GET /api/emails?limit=10&offset=0&isProcessed=true
```

**Get Email by ID**
```
GET /api/emails/:emailId
```

**Search Emails**
```
GET /api/emails/search?q=credito&limit=20
```

**Get Email Statistics**
```
GET /api/emails/stats
```

### Gmail Sync (Real-time) ✨ NEW

**Link Gmail Account**
```
POST /api/gmail/link

Body:
{
  "userId": "user123",
  "email": "user@gmail.com",
  "refreshToken": "1//...",
  "pubSubTopicName": "projects/PROJECT_ID/topics/gmail-notifications"
}

Response:
{
  "status": "linked",
  "userId": "user123",
  "workflowId": "gmail-subscription-user123"
}
```

**Get Gmail Sync Status**
```
GET /api/gmail/status/:userId

Response:
{
  "userId": "user123",
  "email": "user@gmail.com",
  "isActive": true,
  "workflowStatus": "Running",
  "watchExpiration": "2025-01-22T10:00:00Z",
  "lastSyncAt": "2025-01-15T09:30:00Z",
  "totalEmailsSynced": 42
}
```

**Unlink Gmail Account**
```
DELETE /api/gmail/unlink/:userId
```

**Webhook Endpoint (called by Google Pub/Sub)**
```
POST /api/gmail/webhook
```

📖 **See [GMAIL_SYNC_IMPLEMENTATION.md](./GMAIL_SYNC_IMPLEMENTATION.md) for complete setup guide**

---

### Schedule Management (NEW)

**Create Scheduled Email Processing**
```
POST /api/schedules/email-processing

Body:
{
  "name": "Credit Card Emails",
  "searchQuery": "subject:\"Usaste tu tarjeta de credito\"",
  "cronExpression": "* * * * *",
  "maxResults": 50
}
```

**List All Schedules**
```
GET /api/schedules
```

**Get Schedule Details**
```
GET /api/schedules/:scheduleId
```

**Update Schedule**
```
PATCH /api/schedules/:scheduleId

Body:
{
  "searchQuery": "from:no-reply@bank.com",
  "maxResults": 100
}
```

**Pause/Unpause Schedule**
```
POST /api/schedules/:scheduleId/pause
POST /api/schedules/:scheduleId/unpause
```

**Delete Schedule**
```
DELETE /api/schedules/:scheduleId
```

### Workflows

**Start Email Processing Workflow**
```
POST /api/workflows/email-processing

Body:
{
  "searchQuery": "from:no-reply@chase.com",
  "maxResults": 50,
  "afterDate": "2024-01-01"
}

Response:
{
  "workflowId": "email-processing-1234567890",
  "runId": "abc123...",
  "status": "started"
}
```

**Get Workflow Status**
```
GET /api/workflows/:workflowId

Response:
{
  "workflowId": "email-processing-1234567890",
  "status": "COMPLETED",
  "result": {
    "totalEmails": 10,
    "processedCount": 8,
    "failedCount": 2,
    "transactions": [...]
  }
}
```

**Cancel Workflow**
```
POST /api/workflows/:workflowId/cancel
```

## Email Pattern Configuration

Email patterns define how to identify and extract transaction data from specific banks. They're stored in MongoDB and can be customized.

Example Chase pattern:
```javascript
{
  name: "Chase Credit Card Transaction",
  bankName: "Chase",
  accountType: "credit",
  fromAddresses: ["no-reply@chase.com"],
  subjectPatterns: ["Your \\$[0-9,.]+ transaction"],
  bodyKeywords: ["transaction", "merchant"],
  extractionPrompt: "Extract amount, merchant, date...",
  isActive: true,
  priority: 10
}
```

## Monitoring

### Temporal UI

Visit http://localhost:8080 to:
- View workflow executions
- See activity history
- Debug failed workflows
- Replay workflows

### Logs

```bash
# API logs
docker-compose logs -f backend-api

# Worker logs
docker-compose logs -f temporal-worker

# Temporal Server logs
docker-compose logs -f temporal
```

## Troubleshooting

### Docker Issues

**Out of disk space:**
```bash
docker system prune -a
docker volume prune
```

**Services won't start:**
```bash
docker-compose down
docker-compose up -d
docker-compose logs
```

### Gmail API Issues

**Authentication failed:**
- Check credentials in `.env`
- Regenerate refresh token
- Verify Gmail API is enabled

**No emails found:**
- Check search query syntax
- Verify email permissions
- Test with broader query first

### Temporal Issues

**Worker can't connect:**
- Verify Temporal is running: `docker-compose ps`
- Check `TEMPORAL_ADDRESS` in `.env`
- Review worker logs

**Workflow stuck:**
- Check Temporal UI for errors
- Review activity logs
- Verify external API credentials

## Development

### Running Tests

```bash
npm test
```

### Building

```bash
npm run build
```

### Linting

```bash
npm run lint
```

## Documentation

- **[HOW_TO_RUN.md](./HOW_TO_RUN.md)** - Complete setup and running instructions
- **[GMAIL_SYNC_IMPLEMENTATION.md](./GMAIL_SYNC_IMPLEMENTATION.md)** ✨ NEW - Real-time Gmail sync feature guide
- **[IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md)** - Current implementation status
- **[OAUTH_FIX.md](./OAUTH_FIX.md)** - OAuth troubleshooting guide
- **[CREDENTIALS_GUIDE.md](./CREDENTIALS_GUIDE.md)** - Credentials setup guide

## Roadmap

### ✅ Phase 1: Core Features (COMPLETED)
- Gmail integration with OAuth
- Email processing workflows
- AI-powered transaction extraction
- Scheduled processing
- REST API
- Real-time Gmail sync with webhooks ✨ NEW

### Phase 2: Pattern Learning
- Auto-detect new bank email formats
- Machine learning for pattern matching
- Improve extraction accuracy

### Phase 3: Budget Management
- Set category budgets
- Track spending vs budget
- Generate spending alerts

### Phase 4: Advanced Analytics
- Spending trends and insights
- Merchant categorization
- Anomaly detection

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT

## Support

For issues and questions:
- Open a GitHub issue
- Check Temporal documentation: https://docs.temporal.io
- Review Gmail API docs: https://developers.google.com/gmail/api