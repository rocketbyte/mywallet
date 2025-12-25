# 🔑 Credentials Setup Guide

This guide will help you obtain all the credentials needed to run MyWallet.

## Required Credentials

1. **Gmail OAuth Credentials** (Client ID, Client Secret, Refresh Token)
2. **OpenAI API Key**
3. **MongoDB Credentials** (Already set in docker-compose.yml)

---

## 1. Gmail OAuth Credentials

### Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Click **"Select a project"** → **"New Project"**
3. **Project name**: `MyWallet`
4. Click **"Create"**
5. Wait for the project to be created (notification bell will show completion)

### Step 2: Enable Gmail API

1. In your project, go to **"APIs & Services"** → **"Library"**
   - Or direct link: https://console.cloud.google.com/apis/library
2. Search for **"Gmail API"**
3. Click on **"Gmail API"**
4. Click **"Enable"**

### Step 3: Configure OAuth Consent Screen

1. Go to **"APIs & Services"** → **"OAuth consent screen"**
   - Or direct link: https://console.cloud.google.com/apis/credentials/consent
2. Select **"External"** user type
3. Click **"Create"**

**App Information:**
- **App name**: `MyWallet Expense Tracker`
- **User support email**: Your email address
- **App logo**: (Optional - skip)
- **Application home page**: `http://localhost:3000` (or leave blank)
- **Application privacy policy**: (Optional - skip for testing)
- **Application terms of service**: (Optional - skip for testing)
- **Authorized domains**: (Leave blank for testing)
- **Developer contact**: Your email address

4. Click **"Save and Continue"**

**Scopes:**
5. Click **"Add or Remove Scopes"**
6. Filter by "Gmail API"
7. Select these two scopes:
   - `https://www.googleapis.com/auth/gmail.readonly` - View your email messages and settings
   - `https://www.googleapis.com/auth/gmail.modify` - Read, compose, send, and permanently delete all your email from Gmail
8. Click **"Update"**
9. Click **"Save and Continue"**

**Test Users:**
10. Click **"Add Users"**
11. Enter the **Gmail address** you want to use with MyWallet
12. Click **"Add"**
13. Click **"Save and Continue"**

**Summary:**
14. Review and click **"Back to Dashboard"**

### Step 4: Create OAuth Client ID

1. Go to **"APIs & Services"** → **"Credentials"**
   - Or direct link: https://console.cloud.google.com/apis/credentials
2. Click **"Create Credentials"** → **"OAuth 2.0 Client ID"**

3. If prompted to configure consent screen, you should have already done this in Step 3

4. **Application type**: Select **"Desktop app"**
5. **Name**: `MyWallet Desktop Client`
6. Click **"Create"**

7. A dialog will appear with your credentials:
   ```
   Client ID: 123456789-abcdefghijk.apps.googleusercontent.com
   Client Secret: GOCSPX-abcdefghijk123456789
   ```

8. **Copy both values immediately!**

9. Add them to your `.env` file:
   ```env
   GMAIL_CLIENT_ID=123456789-abcdefghijk.apps.googleusercontent.com
   GMAIL_CLIENT_SECRET=GOCSPX-abcdefghijk123456789
   ```

### Step 5: Get Refresh Token

Now that you have the Client ID and Secret in your `.env` file, run our helper script:

```bash
# Make sure you're in the project root
cd /Users/starlingilcruz/Workspace-dev/rocketbyte/mywallet

# Run the OAuth setup script
npm run setup:gmail
```

**What happens:**
1. The script will display a URL
2. Copy and open that URL in your browser
3. Sign in with the Gmail account you added as a test user
4. Click **"Allow"** to grant permissions
5. You'll be redirected to `http://localhost:3000/oauth2callback?code=...`
   - The page will show an error (that's normal - we just need the URL)
6. **Copy the entire URL** from your browser's address bar
7. Paste it into the terminal when prompted
8. The script will display your `GMAIL_REFRESH_TOKEN`
9. Copy it and add to your `.env` file

**Your `.env` should now have:**
```env
GMAIL_CLIENT_ID=123456789-abcdefghijk.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=GOCSPX-abcdefghijk123456789
GMAIL_REFRESH_TOKEN=1//0gAbCdEfGhIjK... (long token)
```

---

## 2. OpenAI API Key

### Step 1: Create OpenAI Account

1. Go to [OpenAI Platform](https://platform.openai.com)
2. Click **"Sign up"** (or **"Log in"** if you have an account)
3. Complete the registration process

### Step 2: Add Payment Method

**⚠️ IMPORTANT**: OpenAI requires a payment method for API access.

1. Go to [Billing Settings](https://platform.openai.com/account/billing/overview)
2. Click **"Add payment method"**
3. Enter your credit/debit card details
4. Set a monthly budget (recommended: start with $10-20)

**Estimated Costs:**
- Processing 100 emails per day ≈ $0.50-1.00/day
- Monthly cost for moderate use ≈ $15-30/month

### Step 3: Create API Key

1. Go to [API Keys](https://platform.openai.com/api-keys)
2. Click **"Create new secret key"**
3. **Name**: `MyWallet`
4. **Permissions**: Leave default (All)
5. Click **"Create secret key"**
6. **Copy the key immediately!** You won't be able to see it again

**The key looks like:**
```
sk-proj-abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ
```

### Step 4: Add to .env

```env
OPENAI_API_KEY=sk-proj-your-actual-key-here
```

---

## 3. MongoDB Credentials (Already Configured)

MongoDB credentials are already set in `docker-compose.yml`:

```env
MONGODB_URI=mongodb://admin:admin123@localhost:27017/mywallet?authSource=admin
```

**These are pre-configured for local development. DO NOT change them unless you know what you're doing.**

---

## Final .env File

Your complete `.env` file should look like this:

```env
# MongoDB (pre-configured)
MONGODB_URI=mongodb://admin:admin123@localhost:27017/mywallet?authSource=admin

# Gmail API (you need to configure these)
GMAIL_CLIENT_ID=123456789-abcdefghijk.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=GOCSPX-abcdefghijk123456789
GMAIL_REFRESH_TOKEN=1//0gAbCdEfGhIjKlMnOpQrStUvWxYz...

# OpenAI (you need to configure this)
OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz...

# Temporal (pre-configured)
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=default

# API Server (pre-configured)
PORT=3000
NODE_ENV=development
```

---

## Verification Checklist

Before running the application, verify:

- [ ] `.env` file exists in project root
- [ ] `GMAIL_CLIENT_ID` starts with numbers and ends with `.apps.googleusercontent.com`
- [ ] `GMAIL_CLIENT_SECRET` starts with `GOCSPX-`
- [ ] `GMAIL_REFRESH_TOKEN` is a long string (200+ characters)
- [ ] `OPENAI_API_KEY` starts with `sk-` or `sk-proj-`
- [ ] Docker services are running (`docker-compose ps`)

---

## Troubleshooting

### "Invalid credentials" error with Gmail

**Solution 1**: Regenerate refresh token
```bash
npm run setup:gmail
```

**Solution 2**: Check OAuth consent screen
- Make sure your Gmail account is added as a test user
- Verify the scopes are correct

**Solution 3**: Revoke and re-authorize
1. Go to https://myaccount.google.com/permissions
2. Remove "MyWallet"
3. Run `npm run setup:gmail` again

### "Insufficient quota" error with OpenAI

**Solution**: Add payment method and set budget
1. Go to https://platform.openai.com/account/billing
2. Add payment method
3. Set monthly budget

### "Connection refused" for MongoDB/Temporal

**Solution**: Start Docker services
```bash
docker-compose up -d
docker-compose ps  # Verify all services are healthy
```

---

## Security Best Practices

1. **Never commit `.env` to git**
   - It's already in `.gitignore`

2. **Keep credentials secret**
   - Don't share them with anyone
   - Don't paste them in public channels

3. **Rotate keys regularly**
   - Change OpenAI API key every 3-6 months
   - Regenerate Gmail refresh token if compromised

4. **Monitor usage**
   - Check OpenAI usage: https://platform.openai.com/usage
   - Check Gmail API quota: https://console.cloud.google.com/apis/api/gmail.googleapis.com/quotas

5. **Set spending limits**
   - OpenAI: Set monthly budget in billing settings
   - Gmail API: Free tier is usually sufficient (1 billion quota units/day)

---

## Need Help?

If you're stuck:

1. **Gmail OAuth Issues**:
   - https://developers.google.com/gmail/api/quickstart/nodejs

2. **OpenAI API Issues**:
   - https://platform.openai.com/docs/quickstart

3. **General Setup**:
   - Check `HOW_TO_RUN.md` in this repo
   - Open a GitHub issue

---

**Ready to go?** Once all credentials are in your `.env` file, follow the [HOW_TO_RUN.md](./HOW_TO_RUN.md) guide to start the application! 🚀
