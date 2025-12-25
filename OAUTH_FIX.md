# Fix: "MyWallet has not completed Google verification process"

## This is Normal! ✅

Your OAuth app is in **Testing mode**, which means only approved test users can access it. You need to add your own Gmail address as a test user.

---

## Quick Fix (2 minutes)

### Step 1: Go to OAuth Consent Screen

1. Open: https://console.cloud.google.com/apis/credentials/consent
2. Make sure you're in the correct project ("MyWallet")

### Step 2: Add Test Users

1. Look for the **"Test users"** section
2. Click **"+ ADD USERS"**
3. Enter **your Gmail address** (the one you want to use with MyWallet)
   - Example: `yourname@gmail.com`
4. Click **"Add"**
5. Click **"Save"** at the bottom

### Step 3: Try Again

1. Run the setup script again:
   ```bash
   npm run setup:gmail
   ```

2. Open the URL in your browser

3. Sign in with the **same Gmail address** you just added as a test user

4. You should now see the consent screen without the warning!

5. Click **"Continue"** → **"Allow"**

---

## Alternative: Use "Internal" User Type (if you have Google Workspace)

If you have a **Google Workspace** account (not regular Gmail):

1. Go to: https://console.cloud.google.com/apis/credentials/consent
2. Click **"EDIT APP"**
3. Change **User Type** from "External" to **"Internal"**
4. Click **"Save"**

This removes the need for test users, but **only works with Google Workspace**, not regular @gmail.com accounts.

---

## What About the "Unverified App" Warning?

When you click "Continue", you might see another screen saying:

> **Google hasn't verified this app**
> This app hasn't been verified by Google yet. Only proceed if you know and trust the developer.

**This is also normal!** You ARE the developer. Click:
1. **"Advanced"** (at the bottom left)
2. **"Go to MyWallet (unsafe)"**
3. **"Allow"**

This warning appears because:
- Your app is in Testing mode
- Google hasn't reviewed it (and doesn't need to for personal use)
- You haven't submitted it for verification (not needed for personal projects)

---

## For Production Use (Optional)

If you want to remove these warnings entirely, you'd need to:

1. Complete Google's OAuth verification process
2. Submit your app for review
3. Wait 4-6 weeks for approval

**But for personal use, this is NOT necessary!** Just add yourself as a test user and you're good to go.

---

## Verification Checklist

- [ ] Added your Gmail address as a test user
- [ ] Using the same Gmail address to sign in
- [ ] Clicked "Continue" on the unverified app warning
- [ ] Clicked "Allow" to grant permissions

---

## Still Having Issues?

**Error: "Access blocked: This app's request is invalid"**

**Solution**: Make sure you added the correct scopes:
1. Go to: https://console.cloud.google.com/apis/credentials/consent
2. Click "EDIT APP"
3. Go to "Scopes" step
4. Verify these two scopes are added:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.modify`

**Error: "You don't have permission to access this app"**

**Solution**:
1. Check that you added your email as a test user
2. Make sure you're signing in with the SAME email address
3. Try logging out of all Google accounts and signing in with just the test user account

---

**Once you add yourself as a test user, run `npm run setup:gmail` again and it should work!** ✅
