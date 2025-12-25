# MyWallet - Email Service Setup & Usage Guide

## 📋 Prerequisites

Before running the system, ensure you have:

- **Node.js** (v18 or higher)
- **Docker & Docker Compose** (for MongoDB and Temporal)
- **Gmail API Credentials** (OAuth2 Client ID, Secret, Refresh Token)
- **OpenAI API Key**

---

## 🚀 Step-by-Step Setup

### Step 1: Install Dependencies

```bash
# From the project root
npm install
```

### Step 2: Configure Environment Variables

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env` and add your credentials:

```env
# MongoDB
MONGODB_URI=mongodb://admin:admin123@localhost:27017/mywallet?authSource=admin

# Gmail API (OAuth2)
GMAIL_CLIENT_ID=your-client-id.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=your-client-secret
GMAIL_REFRESH_TOKEN=your-refresh-token

# OpenAI
OPENAI_API_KEY=sk-your-openai-api-key

# Temporal
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=default

# API Server
PORT=3000
NODE_ENV=development
```

### Step 3: Start Infrastructure (MongoDB + Temporal)

```bash
# Start MongoDB and Temporal Server with Docker Compose
docker-compose up -d

# Verify services are running
docker-compose ps

# You should see:
# - mongodb (port 27017)
# - temporal (port 7233)
# - temporal-web (port 8080)
```

**Access Temporal UI**: http://localhost:8080

### Step 4: Seed Email Patterns (Optional)

Seed the database with Chase bank email patterns:

```bash
npm run seed:patterns
```

### Step 5: Start the Temporal Worker

The worker processes workflows and executes activities:

```bash
cd packages/temporal-worker
npm run dev
```

**You should see:**
```
🚀 Starting Temporal Worker...
✅ MongoDB connected
✅ Gmail client initialized
✅ OpenAI client initialized
✅ All activities registered
✅ Connected to Temporal
👂 Worker polling for tasks...
```

### Step 6: Start the API Server

In a **new terminal**:

```bash
cd packages/backend-apis
npm run dev
```

**You should see:**
```
✅ Connected to MongoDB
🚀 MyWallet API Server listening on port 3000
✅ Ready to accept requests!
```

---

## 📖 Using the Email Service

### 1. Create a Scheduled Email Processing Job

This creates a cron job that runs **every minute** to fetch and process emails:

```bash
curl -X POST http://localhost:3000/api/schedules/email-processing \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Credit Card Transaction Emails",
    "description": "Process credit card transaction notifications",
    "searchQuery": "subject:\"Usaste tu tarjeta de credito\"",
    "cronExpression": "* * * * *",
    "maxResults": 50
  }'
```

**Response:**
```json
{
  "scheduleId": "email-processing-schedule-1234567890",
  "name": "Credit Card Transaction Emails",
  "searchQuery": "subject:\"Usaste tu tarjeta de credito\"",
  "cronExpression": "* * * * *",
  "status": "created",
  "message": "Email processing schedule created successfully"
}
```

**Save the `scheduleId`** - you'll need it to manage the schedule.

### 2. Verify Schedule is Running

Check the Temporal UI to see your schedule:
- Open http://localhost:8080
- Click **"Schedules"** in the left menu
- You should see your schedule with next run time

### 3. Wait for Emails to be Processed

The cron runs every minute. After 1-2 minutes:

**Check worker logs** - you should see:
```
Starting scheduled email processing
Fetched 5 emails from Gmail
Stored email: abc123 - Usaste tu tarjeta de credito...
Processing email: abc123
Transaction extracted: Merchant XYZ, Amount: $45.50
Successfully processed email
```

**Check API server logs** - MongoDB activity should be visible.

---

## 📊 Querying Emails via API

### Get All Emails (with pagination)

```bash
curl "http://localhost:3000/api/emails?limit=10&offset=0"
```

**Response:**
```json
{
  "emails": [
    {
      "id": "507f1f77bcf86cd799439011",
      "emailId": "18c2f3a1b2d4e5f6",
      "from": "no-reply@bank.com",
      "subject": "Usaste tu tarjeta de credito",
      "date": "2024-01-15T10:30:00Z",
      "snippet": "Se realizó una compra por $45.50...",
      "isProcessed": true,
      "transactionId": "507f1f77bcf86cd799439012",
      "confidence": 0.95,
      "fetchedAt": "2024-01-15T10:31:00Z"
    }
  ],
  "pagination": {
    "total": 25,
    "limit": 10,
    "offset": 0,
    "hasMore": true
  }
}
```

### Filter Processed/Unprocessed Emails

```bash
# Only processed emails
curl "http://localhost:3000/api/emails?isProcessed=true"

# Only unprocessed emails
curl "http://localhost:3000/api/emails?isProcessed=false"

# Filter by sender
curl "http://localhost:3000/api/emails?fromAddress=no-reply@bank.com"

# Filter by date range
curl "http://localhost:3000/api/emails?startDate=2024-01-01&endDate=2024-01-31"
```

### Get Specific Email by ID

```bash
curl "http://localhost:3000/api/emails/18c2f3a1b2d4e5f6"
```

**Response includes full email body and all metadata.**

### Search Emails by Text

```bash
curl "http://localhost:3000/api/emails/search?q=credito&limit=20"
```

Searches in both **subject** and **body** using full-text search.

### Get Email Statistics

```bash
curl "http://localhost:3000/api/emails/stats"
```

**Response:**
```json
{
  "stats": {
    "total": 150,
    "processed": 142,
    "unprocessed": 8,
    "processingRate": "94.67%"
  }
}
```

---

## ⚙️ Managing Schedules

### List All Schedules

```bash
curl "http://localhost:3000/api/schedules"
```

**Response:**
```json
{
  "schedules": [
    {
      "scheduleId": "email-processing-schedule-1234567890",
      "name": "Credit Card Transaction Emails",
      "isActive": true,
      "searchQuery": "subject:\"Usaste tu tarjeta de credito\"",
      "cronExpression": "* * * * *",
      "nextRunTime": "2024-01-15T10:32:00Z",
      "lastRunAt": "2024-01-15T10:31:00Z",
      "lastRunStatus": "success",
      "stats": {
        "totalRuns": 15,
        "totalEmailsFetched": 45,
        "totalEmailsProcessed": 42,
        "totalErrors": 3
      }
    }
  ],
  "total": 1
}
```

### Get Schedule Details

```bash
curl "http://localhost:3000/api/schedules/email-processing-schedule-1234567890"
```

### Pause a Schedule

Temporarily stop the cron:

```bash
curl -X POST "http://localhost:3000/api/schedules/email-processing-schedule-1234567890/pause"
```

**Response:**
```json
{
  "scheduleId": "email-processing-schedule-1234567890",
  "status": "paused",
  "message": "Schedule paused successfully"
}
```

### Resume a Paused Schedule

```bash
curl -X POST "http://localhost:3000/api/schedules/email-processing-schedule-1234567890/unpause"
```

### Update Schedule Configuration

Change the search query or other settings:

```bash
curl -X PATCH "http://localhost:3000/api/schedules/email-processing-schedule-1234567890" \
  -H "Content-Type: application/json" \
  -d '{
    "searchQuery": "from:no-reply@bank.com subject:transaction",
    "maxResults": 100
  }'
```

**Note:** Changes take effect on the **next scheduled run**.

### Delete a Schedule

Permanently stop and remove the schedule:

```bash
curl -X DELETE "http://localhost:3000/api/schedules/email-processing-schedule-1234567890"
```

**Response:**
```json
{
  "scheduleId": "email-processing-schedule-1234567890",
  "status": "deleted",
  "message": "Schedule deleted successfully"
}
```

---

## 📧 Gmail Sync Setup & Testing

The Gmail Sync feature uses Temporal workflows to manage OAuth tokens and Gmail watch() subscriptions for real-time email processing.

### Prerequisites for Gmail Sync

1. **Gmail OAuth Credentials** - Already configured in `.env`
2. **Gmail Refresh Token** - Obtained through OAuth flow
3. **Google Cloud Pub/Sub** (optional for push notifications)

### Step 1: Obtain Gmail Refresh Token

If you haven't already obtained a refresh token, follow these steps:

#### 1.1 Start the API Server

```bash
cd packages/backend-apis
npm run dev
```

#### 1.2 Visit the OAuth Authorization Page

Open your browser and visit:
```
http://localhost:3000/api/auth/gmail
```

#### 1.3 Authorize Gmail Access

1. Click **"Authorize Gmail Access"** button
2. Sign in with your Gmail account
3. Review and grant the requested permissions:
   - Read Gmail messages
   - Modify Gmail messages (for labeling)
4. Click **"Allow"** or **"Continue"**

#### 1.4 Copy the Refresh Token

After authorization, you'll be redirected to a success page showing your refresh token. Copy it.

#### 1.5 Update .env File

Add the refresh token to your `.env` file in the project root:

```env
GMAIL_REFRESH_TOKEN=1//01bTIl...your-refresh-token...
```

#### 1.6 Restart Services

Stop both the worker and API server (Ctrl+C), then restart them:

**Terminal 1 - Worker:**
```bash
cd packages/temporal-worker
npm run dev
```

You should see:
```
Loading .env from: /Users/.../mywallet/.env
Environment loaded. GMAIL_REFRESH_TOKEN: SET
✅ Gmail client initialized
```

**Terminal 2 - API Server:**
```bash
cd packages/backend-apis
npm run dev
```

### Step 2: Link Your Gmail Account

Start the Gmail subscription workflow:

```bash
curl -X POST http://localhost:3000/api/gmail/link \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user-123",
    "email": "your-email@gmail.com"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "workflowId": "gmail-subscription-test-user-123",
  "message": "Gmail account linked and sync started",
  "account": {
    "userId": "test-user-123",
    "email": "your-email@gmail.com",
    "isActive": true,
    "watchExpiration": "2025-12-30T15:00:00Z"
  }
}
```

### Step 3: Verify Workflow in Temporal UI

1. Open http://localhost:8233 (or 8080 depending on your setup)
2. Click on **"Workflows"** in the left menu
3. Look for workflow ID: `gmail-subscription-test-user-123`
4. Status should be: **Running**
5. Click on the workflow to see details:
   - Current state: Sleeping (waiting for watch renewal or webhook)
   - Next renewal: ~5 days from now
   - Signal handlers registered: `incomingWebhook`, `stopSync`

### Step 4: Check Gmail Account Status

Get the current status of your linked account:

```bash
curl http://localhost:3000/api/gmail/status/test-user-123
```

**Expected Response:**
```json
{
  "userId": "test-user-123",
  "email": "your-email@gmail.com",
  "isActive": true,
  "workflowId": "gmail-subscription-test-user-123",
  "watchExpiration": "2025-12-30T15:00:00.000Z",
  "historyId": "12345",
  "totalEmailsSynced": 0,
  "createdAt": "2025-12-25T15:00:00.000Z",
  "updatedAt": "2025-12-25T15:00:00.000Z"
}
```

### Step 5: Test Webhook Signal (Simulated)

Simulate a Gmail push notification to test the signal handling:

```bash
curl -X POST http://localhost:3000/api/gmail/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "data": "eyJlbWFpbEFkZHJlc3MiOiJ5b3VyLWVtYWlsQGdtYWlsLmNvbSIsImhpc3RvcnlJZCI6IjEyMzQ1In0=",
      "messageId": "test-message-123",
      "publishTime": "2025-12-25T15:00:00Z"
    },
    "subscription": "projects/mywallet-481322/subscriptions/gmail-notifications-sub"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Webhook received and signal sent to workflow"
}
```

**Check Worker Logs** - you should see:
```
Received webhook notification for user: test-user-123
Fetching Gmail changes since historyId: 12345
Processing 2 new emails...
Successfully synced 2 emails
```

### Step 6: Verify Email Syncing

Check MongoDB to see if emails were synced:

```bash
# Connect to MongoDB
docker exec -it mywallet-mongodb-1 mongosh -u admin -p admin123 --authenticationDatabase admin

# Use the database
use mywallet

# Check Gmail accounts
db.gmail_accounts.find().pretty()

# Check synced emails
db.emails.find({userId: "test-user-123"}).sort({fetchedAt: -1}).limit(5).pretty()

# Exit
exit
```

### Step 7: Unlink Gmail Account (When Done Testing)

Stop the workflow and deactivate the account:

```bash
curl -X DELETE http://localhost:3000/api/gmail/unlink/test-user-123
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Gmail account unlinked and sync stopped"
}
```

This will:
- Send a `stopSync` signal to the workflow
- Mark the GmailAccount as inactive
- Stop the Gmail watch
- Terminate the workflow gracefully

### Gmail Sync Architecture

**How it works:**

1. **Workflow Lifecycle:**
   - Runs indefinitely (uses `continueAsNew` after 30 days)
   - Sleeps for 5 days between watch renewals
   - Processes webhooks immediately when they arrive via signals

2. **Watch Management:**
   - Gmail watch expires after 7 days
   - Workflow renews it every 5 days (buffer of 2 days)
   - If renewal fails, retries with exponential backoff

3. **Token Refresh:**
   - Access token expires after 1 hour
   - Automatically refreshed when needed
   - Uses refresh token stored in GmailAccount

4. **Webhook Processing:**
   - Google sends push notification when email arrives
   - Pub/Sub delivers to `/api/gmail/webhook`
   - Signal sent to workflow via `incomingWebhook`
   - Workflow processes changes using Gmail History API

### Testing with Real Gmail Push Notifications (Optional)

To test with real Gmail push notifications, you need to expose your local server:

#### Option A: Using ngrok

```bash
# Install ngrok
brew install ngrok

# Expose port 3000
ngrok http 3000
```

Copy the ngrok URL (e.g., `https://abc123.ngrok.io`)

#### Option B: Update Pub/Sub Subscription

Update your Google Cloud Pub/Sub subscription:

```bash
gcloud pubsub subscriptions update gmail-notifications-sub \
  --push-endpoint=https://your-ngrok-url.ngrok.io/api/gmail/webhook
```

Now when emails arrive in Gmail, Google will send real push notifications to your local server!

### Gmail Sync API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/gmail/link` | POST | Link Gmail account and start sync workflow |
| `/api/gmail/unlink/:userId` | DELETE | Unlink account and stop workflow |
| `/api/gmail/status/:userId` | GET | Get sync status and account details |
| `/api/gmail/webhook` | POST | Receive Gmail push notifications (Pub/Sub) |

### What to Verify

✅ **Environment Variables Loaded** - Worker shows "GMAIL_REFRESH_TOKEN: SET"
✅ **OAuth Flow Works** - Successfully obtain refresh token
✅ **Account Linked** - API returns success response
✅ **Workflow Running** - Visible in Temporal UI with status "Running"
✅ **GmailAccount Created** - Record exists in MongoDB
✅ **Webhook Signals Work** - Worker logs show webhook processing
✅ **Emails Synced** - Check MongoDB for new email records
✅ **Watch Renewed** - After 5 days, watch is renewed automatically
✅ **Graceful Unlink** - Workflow stops cleanly when unlinked

---

## 🔍 Monitoring & Debugging

### Check Temporal UI

1. Open http://localhost:8080
2. Navigate to **"Workflows"** to see running workflows
3. Navigate to **"Schedules"** to see your cron schedules
4. Click on any workflow to see detailed execution logs

### Check Worker Logs

The worker terminal shows real-time processing:

```
Starting scheduled email processing
Fetched 3 emails from Gmail
Email already exists: 18c2f3a1b2d4e5f6  (duplicate, skipped)
Stored email: 18c2f3a1b2d4e5f7
Processing email: 18c2f3a1b2d4e5f7
Matched pattern: Chase Credit Card Transaction
Transaction extracted: merchant=Amazon, amount=25.99, confidence=0.92
Successfully processed email
Scheduled email processing completed: fetched=3, stored=2, processed=2
```

### Check API Server Logs

The API server shows HTTP requests and database operations.

### Check MongoDB Directly

```bash
# Connect to MongoDB
docker exec -it mywallet-mongodb-1 mongosh -u admin -p admin123 --authenticationDatabase admin

# Switch to database
use mywallet

# Count emails
db.emails.countDocuments()

# View recent emails
db.emails.find().sort({createdAt: -1}).limit(5).pretty()

# View schedules
db.schedule_configs.find().pretty()

# Exit
exit
```

---

## 🛠️ Troubleshooting

### Issue: "Failed to connect to MongoDB"

**Solution:**
```bash
# Check if MongoDB is running
docker-compose ps

# Restart MongoDB
docker-compose restart mongodb

# Check MongoDB logs
docker-compose logs mongodb
```

### Issue: "Failed to connect to Temporal"

**Solution:**
```bash
# Check if Temporal is running
docker-compose ps

# Restart Temporal
docker-compose restart temporal

# Check Temporal logs
docker-compose logs temporal
```

### Issue: "Gmail authentication error"

**Solution:**
- Verify your `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_REFRESH_TOKEN` in `.env`
- Make sure the refresh token hasn't expired
- Re-authorize your Gmail OAuth app if needed

### Issue: "No emails found"

**Possible causes:**
1. **Search query doesn't match any emails** - Try a broader query like `subject:transaction`
2. **Emails already processed** - Check `isProcessed=false` emails
3. **Gmail labels** - Emails may already have the "MYWALLET_PROCESSED" label

**Test with a broader search:**
```bash
curl -X PATCH "http://localhost:3000/api/schedules/YOUR_SCHEDULE_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "searchQuery": "from:no-reply"
  }'
```

### Issue: "Low confidence extraction"

If transactions fail with low confidence:
1. Check OpenAI logs in worker
2. Verify the email pattern in MongoDB matches your emails
3. Adjust the `extractionPrompt` in email patterns
4. Lower `CONFIDENCE_THRESHOLD` in constants.ts (default: 0.7)

### Issue: "No access, refresh token, API key or refresh handler callback is set"

This means the Gmail client isn't configured with the refresh token.

**Solution:**
1. Verify `GMAIL_REFRESH_TOKEN` is set in `.env` file
2. Check worker logs on startup - should show "Environment loaded. GMAIL_REFRESH_TOKEN: SET"
3. If not SET, restart the worker:
   ```bash
   # Stop worker (Ctrl+C)
   cd packages/temporal-worker
   npm run dev
   ```

### Issue: "Gmail account linking fails"

**Possible causes:**
1. **Invalid refresh token** - Token may have expired or been revoked
2. **Gmail API quota exceeded** - Check Google Cloud Console quotas
3. **Workflow already running** - Can't link the same userId twice

**Solution:**
```bash
# Check if workflow already exists
curl http://localhost:3000/api/gmail/status/test-user-123

# If exists, unlink first
curl -X DELETE http://localhost:3000/api/gmail/unlink/test-user-123

# Then re-link
curl -X POST http://localhost:3000/api/gmail/link \
  -H "Content-Type: application/json" \
  -d '{"userId":"test-user-123","email":"your-email@gmail.com"}'
```

### Issue: "Webhook returns 404"

**Possible causes:**
1. Wrong URL path (missing `/api` prefix)
2. API server not running
3. Route not registered

**Solution:**
1. Verify the URL is `http://localhost:3000/api/gmail/webhook`
2. Check API server logs for route registration
3. Test with curl:
   ```bash
   curl -X POST http://localhost:3000/api/gmail/webhook \
     -H "Content-Type: application/json" \
     -d '{"message":{"data":"test"}}'
   ```

### Issue: "OAuth callback error: Cannot GET /auth/gmail/callback"

**Solution:**
The redirect URI is missing the `/api` prefix. Update `.env`:
```env
GMAIL_REDIRECT_URI=http://localhost:3000/api/auth/gmail/callback
```

Then update in Google Cloud Console:
1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Edit your OAuth 2.0 Client ID
3. Add redirect URI: `http://localhost:3000/api/auth/gmail/callback`
4. Save and restart API server

---

## 🧹 Cleanup & Shutdown

### Stop Services

```bash
# Stop worker (Ctrl+C in worker terminal)

# Stop API server (Ctrl+C in API terminal)

# Stop Docker services
docker-compose down

# Remove all data (optional - WARNING: deletes all emails and schedules)
docker-compose down -v
```

---

## 📚 Additional Resources

### Cron Expression Examples

```
* * * * *       # Every minute
*/5 * * * *     # Every 5 minutes
0 * * * *       # Every hour
0 9 * * *       # Every day at 9 AM
0 9 * * 1-5     # Every weekday at 9 AM
0 0 1 * *       # First day of every month at midnight
```

### Gmail Search Query Examples

```
subject:"Usaste tu tarjeta de credito"
from:no-reply@chase.com
from:alerts@bank.com subject:transaction
after:2024/01/01 subject:payment
is:unread from:no-reply
```

### Useful Commands

```bash
# View all running Docker containers
docker ps

# View logs for specific service
docker-compose logs -f temporal
docker-compose logs -f mongodb

# Restart all services
docker-compose restart

# Check disk space (MongoDB data)
docker system df

# Backup MongoDB data
docker exec mywallet-mongodb-1 mongodump --archive=/backup.gz --gzip
docker cp mywallet-mongodb-1:/backup.gz ./backup.gz
```

---

## ✅ Success Checklist

### Core Setup
- [ ] Docker services running (MongoDB + Temporal)
- [ ] `.env` file configured with all credentials
- [ ] Dependencies installed (`npm install`)
- [ ] Worker running and connected to Temporal
- [ ] API server running and connected to MongoDB
- [ ] Temporal UI accessible at http://localhost:8233 or 8080

### Email Processing (Scheduled)
- [ ] Schedule created successfully
- [ ] Emails being fetched and processed every minute
- [ ] Able to query emails via API
- [ ] Transactions extracted and stored

### Gmail Sync (Real-time)
- [ ] Gmail refresh token obtained via OAuth flow
- [ ] Worker shows "GMAIL_REFRESH_TOKEN: SET" on startup
- [ ] Gmail account linked successfully
- [ ] Workflow running in Temporal UI
- [ ] GmailAccount record created in MongoDB
- [ ] Webhook endpoint responds correctly
- [ ] Emails synced in real-time when webhook triggered

---

## 🎉 You're All Set!

Your MyWallet email service is now running and processing emails automatically every minute. Transactions are being extracted and stored in MongoDB, ready to be queried via the REST API.

**Next Steps:**
- Add more email patterns for different banks
- Create a frontend to visualize transactions
- Set up alerts for specific transaction types
- Export data to CSV or Excel

Happy coding! 🚀
