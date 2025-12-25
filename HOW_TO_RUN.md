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

- [ ] Docker services running (MongoDB + Temporal)
- [ ] `.env` file configured with all credentials
- [ ] Dependencies installed (`npm install`)
- [ ] Worker running and connected to Temporal
- [ ] API server running and connected to MongoDB
- [ ] Schedule created successfully
- [ ] Emails being fetched and processed every minute
- [ ] Able to query emails via API
- [ ] Temporal UI accessible at http://localhost:8080

---

## 🎉 You're All Set!

Your MyWallet email service is now running and processing emails automatically every minute. Transactions are being extracted and stored in MongoDB, ready to be queried via the REST API.

**Next Steps:**
- Add more email patterns for different banks
- Create a frontend to visualize transactions
- Set up alerts for specific transaction types
- Export data to CSV or Excel

Happy coding! 🚀
