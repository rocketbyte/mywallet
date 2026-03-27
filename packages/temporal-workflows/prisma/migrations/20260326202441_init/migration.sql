-- CreateTable
CREATE TABLE "emails" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "emailId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "body" TEXT NOT NULL,
    "snippet" TEXT NOT NULL DEFAULT '',
    "rawHtml" TEXT,
    "isProcessed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "processingWorkflowId" TEXT,
    "matchedPatternId" TEXT,
    "matchedPatternName" TEXT,
    "transactionId" TEXT,
    "processingError" TEXT,
    "confidence" DOUBLE PRECISION,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetchedBy" TEXT NOT NULL DEFAULT 'unknown',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "emailId" TEXT NOT NULL,
    "emailSubject" TEXT NOT NULL DEFAULT '',
    "emailDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailFrom" TEXT NOT NULL DEFAULT '',
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "merchant" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "transactionType" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "bankName" TEXT NOT NULL DEFAULT '',
    "rawEmailText" TEXT NOT NULL DEFAULT '',
    "extractedData" JSONB NOT NULL DEFAULT '{}',
    "confidence" DOUBLE PRECISION NOT NULL,
    "workflowId" TEXT NOT NULL DEFAULT '',
    "workflowRunId" TEXT NOT NULL DEFAULT '',
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_patterns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountType" TEXT NOT NULL DEFAULT 'checking',
    "fromAddresses" TEXT[],
    "subjectPatterns" TEXT[],
    "bodyKeywords" TEXT[],
    "extractionPrompt" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "matchCount" INTEGER NOT NULL DEFAULT 0,
    "successRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastMatchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gmail_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "currentAccessToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "watchExpiration" TIMESTAMP(3),
    "historyId" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "workflowId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "pubSubTopicName" TEXT NOT NULL,
    "pubSubSubscription" TEXT,
    "totalEmailsSynced" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gmail_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "categories" JSONB NOT NULL DEFAULT '[]',
    "totalBudget" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalSpent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastCalculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_steps" (
    "id" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0,
    "systemPrompt" TEXT NOT NULL,
    "userPromptTemplate" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "maxTokens" INTEGER NOT NULL DEFAULT 500,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_configs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "searchQuery" TEXT NOT NULL,
    "cronExpression" TEXT NOT NULL DEFAULT '* * * * *',
    "maxResults" INTEGER NOT NULL DEFAULT 50,
    "afterDate" TIMESTAMP(3),
    "skipProcessed" BOOLEAN NOT NULL DEFAULT true,
    "totalRuns" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "totalEmailsFetched" INTEGER NOT NULL DEFAULT 0,
    "totalEmailsProcessed" INTEGER NOT NULL DEFAULT 0,
    "totalErrors" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "emails_emailId_key" ON "emails"("emailId");

-- CreateIndex
CREATE INDEX "emails_isProcessed_date_idx" ON "emails"("isProcessed", "date" DESC);

-- CreateIndex
CREATE INDEX "emails_userId_isProcessed_idx" ON "emails"("userId", "isProcessed");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_emailId_key" ON "transactions"("emailId");

-- CreateIndex
CREATE INDEX "transactions_transactionDate_category_idx" ON "transactions"("transactionDate" DESC, "category");

-- CreateIndex
CREATE INDEX "transactions_userId_transactionDate_idx" ON "transactions"("userId", "transactionDate" DESC);

-- CreateIndex
CREATE INDEX "transactions_workflowId_idx" ON "transactions"("workflowId");

-- CreateIndex
CREATE INDEX "transactions_bankName_accountNumber_idx" ON "transactions"("bankName", "accountNumber");

-- CreateIndex
CREATE UNIQUE INDEX "email_patterns_name_key" ON "email_patterns"("name");

-- CreateIndex
CREATE INDEX "email_patterns_isActive_priority_idx" ON "email_patterns"("isActive", "priority" DESC);

-- CreateIndex
CREATE INDEX "email_patterns_bankName_idx" ON "email_patterns"("bankName");

-- CreateIndex
CREATE UNIQUE INDEX "gmail_accounts_userId_key" ON "gmail_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "gmail_accounts_workflowId_key" ON "gmail_accounts"("workflowId");

-- CreateIndex
CREATE INDEX "gmail_accounts_isActive_watchExpiration_idx" ON "gmail_accounts"("isActive", "watchExpiration");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_userId_year_month_key" ON "budgets"("userId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_steps_stepKey_key" ON "pipeline_steps"("stepKey");

-- CreateIndex
CREATE INDEX "pipeline_steps_order_isActive_idx" ON "pipeline_steps"("order", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_configs_scheduleId_key" ON "schedule_configs"("scheduleId");

-- CreateIndex
CREATE INDEX "schedule_configs_userId_isActive_idx" ON "schedule_configs"("userId", "isActive");
