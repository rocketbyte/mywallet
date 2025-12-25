/**
 * Gmail OAuth Token Generator
 *
 * This script helps you get a Gmail refresh token for the MyWallet app.
 *
 * Prerequisites:
 * 1. You must have GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET from Google Cloud Console
 * 2. Add those to your .env file first
 *
 * Usage:
 * 1. node scripts/get-gmail-token.js
 * 2. Open the URL that appears in your browser
 * 3. Sign in with your Gmail account
 * 4. Copy the authorization code from the redirect URL
 * 5. Paste it when prompted
 * 6. Copy the refresh token to your .env file
 */

const { google } = require('googleapis');
const readline = require('readline');
require('dotenv').config();

// OAuth2 client configuration
const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  'http://localhost:3000/oauth2callback' // Redirect URI
);

// Scopes required
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify'
];

// Generate authorization URL
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent' // Force to get refresh token
});

console.log('\n🔐 Gmail OAuth Token Generator\n');
console.log('Step 1: Open this URL in your browser:\n');
console.log(authUrl);
console.log('\n');
console.log('Step 2: Sign in with your Gmail account');
console.log('Step 3: After authorization, you\'ll be redirected to a URL like:');
console.log('        http://localhost:3000/oauth2callback?code=4/0AY0e-g7...');
console.log('\n');
console.log('Step 4: Copy the ENTIRE URL from your browser\'s address bar\n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Paste the redirect URL here: ', async (redirectUrl) => {
  try {
    // Extract code from URL
    const url = new URL(redirectUrl);
    const code = url.searchParams.get('code');

    if (!code) {
      console.error('\n❌ Error: No authorization code found in URL');
      console.error('Make sure you copied the complete URL from the browser');
      rl.close();
      return;
    }

    console.log('\n⏳ Exchanging authorization code for tokens...\n');

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    console.log('✅ Success! Here are your tokens:\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('Add these to your .env file:\n');
    console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('⚠️  IMPORTANT: Keep this refresh token secret!');
    console.log('   It allows access to your Gmail account.\n');

    if (tokens.access_token) {
      console.log('Access token (expires in 1 hour):');
      console.log(tokens.access_token);
      console.log('');
    }

  } catch (error) {
    console.error('\n❌ Error getting tokens:', error.message);
    if (error.message.includes('invalid_grant')) {
      console.error('\nThis usually means:');
      console.error('1. The authorization code expired (they expire in 10 minutes)');
      console.error('2. The code was already used');
      console.error('\nPlease run the script again and use a fresh code.\n');
    }
  }

  rl.close();
});

rl.on('close', () => {
  process.exit(0);
});
