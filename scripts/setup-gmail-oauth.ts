/**
 * Gmail OAuth Token Generator (TypeScript)
 *
 * This script helps you get a Gmail refresh token for the MyWallet app.
 *
 * Prerequisites:
 * 1. You must have GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET from Google Cloud Console
 * 2. Add those to your .env file first
 *
 * Usage:
 * npm run setup:gmail
 */

import { google } from 'googleapis';
import * as readline from 'readline';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

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

async function main() {
  console.log('\n🔐 Gmail OAuth Token Generator\n');

  // Check if credentials exist
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) {
    console.error('❌ Error: Missing Gmail credentials in .env file\n');
    console.error('Please add the following to your .env file:');
    console.error('  GMAIL_CLIENT_ID=your-client-id.apps.googleusercontent.com');
    console.error('  GMAIL_CLIENT_SECRET=your-client-secret\n');
    process.exit(1);
  }

  // Generate authorization URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent' // Force to get refresh token
  });

  console.log('Step 1: Open this URL in your browser:\n');
  console.log('\x1b[36m%s\x1b[0m\n', authUrl); // Cyan color
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
        console.error('Make sure you copied the complete URL from the browser\n');
        rl.close();
        process.exit(1);
      }

      console.log('\n⏳ Exchanging authorization code for tokens...\n');

      // Exchange code for tokens
      const { tokens } = await oauth2Client.getToken(code);

      if (!tokens.refresh_token) {
        console.error('❌ Error: No refresh token received');
        console.error('This might happen if you already authorized this app before.');
        console.error('\nTo fix this:');
        console.error('1. Go to https://myaccount.google.com/permissions');
        console.error('2. Remove "MyWallet" from the list');
        console.error('3. Run this script again\n');
        rl.close();
        process.exit(1);
      }

      console.log('✅ Success! Here are your credentials:\n');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log('Add this to your .env file:\n');
      console.log('\x1b[32m%s\x1b[0m', `GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`); // Green
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log('⚠️  IMPORTANT: Keep this refresh token secret!');
      console.log('   It allows access to your Gmail account.\n');

      console.log('✅ Setup complete! You can now start the application.\n');

    } catch (error: any) {
      console.error('\n❌ Error getting tokens:', error.message);
      if (error.message.includes('invalid_grant')) {
        console.error('\nThis usually means:');
        console.error('1. The authorization code expired (they expire in 10 minutes)');
        console.error('2. The code was already used');
        console.error('\nPlease run the script again and use a fresh code.\n');
      }
    }

    rl.close();
    process.exit(0);
  });
}

main().catch(console.error);
