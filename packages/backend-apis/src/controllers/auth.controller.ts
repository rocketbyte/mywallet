import { Request, Response } from 'express';
import { google } from 'googleapis';
import { logger } from '../utils/logger';

export class AuthController {
  private oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );

  /**
   * GET /api/auth/gmail
   * Step 1: Get OAuth authorization URL
   *
   * Usage:
   * 1. Visit http://localhost:3000/api/auth/gmail in browser
   * 2. Copy the authUrl from response
   * 3. Open authUrl in browser to start OAuth flow
   */
  getAuthUrl(req: Request, res: Response) {
    try {
      const authUrl = this.oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/gmail.modify'
        ],
        prompt: 'consent' // Force to get refresh token
      });

      logger.info('Generated OAuth URL');

      // Return both JSON and HTML for easy use
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Gmail OAuth - Step 1</title>
            <style>
              body {
                font-family: Arial, sans-serif;
                max-width: 800px;
                margin: 50px auto;
                padding: 20px;
                background: #f5f5f5;
              }
              .container {
                background: white;
                padding: 30px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
              }
              h1 { color: #4285f4; }
              .btn {
                display: inline-block;
                background: #4285f4;
                color: white;
                padding: 12px 24px;
                text-decoration: none;
                border-radius: 4px;
                font-size: 16px;
                margin: 20px 0;
              }
              .btn:hover {
                background: #357ae8;
              }
              .info-box {
                background: #e3f2fd;
                border-left: 4px solid #2196F3;
                padding: 15px;
                margin: 20px 0;
              }
              .url-box {
                background: #f5f5f5;
                padding: 15px;
                border-radius: 4px;
                word-break: break-all;
                font-family: monospace;
                font-size: 12px;
                margin: 10px 0;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>🔐 Gmail OAuth Setup - Step 1</h1>

              <div class="info-box">
                <strong>📝 Instructions:</strong>
                <ol>
                  <li>Click the button below to authorize Gmail access</li>
                  <li>Sign in with your Gmail account</li>
                  <li>Grant the requested permissions</li>
                  <li>You'll be redirected back to get your refresh token</li>
                </ol>
              </div>

              <a href="${authUrl}" class="btn" target="_blank">
                🚀 Authorize Gmail Access
              </a>

              <h3>Or copy the authorization URL:</h3>
              <div class="url-box">${authUrl}</div>

              <div class="info-box">
                <strong>⚠️ Note:</strong> You may see "Google hasn't verified this app".
                This is normal. Click "Advanced" → "Go to MyWallet (unsafe)" to continue.
              </div>
            </div>
          </body>
        </html>
      `;

      // Check if request wants JSON or HTML
      if (req.headers.accept?.includes('application/json')) {
        res.json({
          authUrl,
          instructions: [
            '1. Visit the authUrl in your browser',
            '2. Sign in with your Gmail account',
            '3. Grant permissions',
            '4. You will be redirected back with your refresh token'
          ]
        });
      } else {
        res.send(html);
      }
    } catch (error) {
      logger.error('Failed to generate auth URL', { error });
      res.status(500).json({
        error: 'Failed to generate authorization URL',
        message: (error as Error).message
      });
    }
  }

  /**
   * GET /api/auth/gmail/callback
   * Step 2: Handle OAuth callback and exchange code for tokens
   *
   * This endpoint is called automatically by Google after user authorizes
   */
  async handleCallback(req: Request, res: Response) {
    const { code, error } = req.query;

    // Handle OAuth errors
    if (error) {
      logger.error('OAuth authorization failed', { error });
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>OAuth Error</title>
            <style>
              body {
                font-family: Arial, sans-serif;
                max-width: 800px;
                margin: 50px auto;
                padding: 20px;
              }
              .error-box {
                background: #ffebee;
                border-left: 4px solid #f44336;
                padding: 20px;
                border-radius: 4px;
              }
              h1 { color: #f44336; }
            </style>
          </head>
          <body>
            <div class="error-box">
              <h1>❌ Authorization Failed</h1>
              <p><strong>Error:</strong> ${error}</p>
              <p><a href="/api/auth/gmail">← Try again</a></p>
            </div>
          </body>
        </html>
      `);
    }

    if (!code) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>OAuth Error</title>
            <style>
              body { font-family: Arial; padding: 50px; }
              .error-box { background: #ffebee; padding: 20px; border-radius: 4px; }
            </style>
          </head>
          <body>
            <div class="error-box">
              <h1>❌ Error</h1>
              <p>No authorization code provided</p>
              <p><a href="/api/auth/gmail">← Start over</a></p>
            </div>
          </body>
        </html>
      `);
    }

    try {
      // Exchange authorization code for tokens
      const { tokens } = await this.oauth2Client.getToken(code as string);
      const refreshToken = tokens.refresh_token;
      const accessToken = tokens.access_token;

      logger.info('Successfully obtained tokens', {
        hasRefreshToken: !!refreshToken,
        hasAccessToken: !!accessToken
      });

      // Get user's email address
      const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
      this.oauth2Client.setCredentials(tokens);

      let userEmail = 'your-email@gmail.com';
      try {
        const userInfo = await oauth2.userinfo.get();
        userEmail = userInfo.data.email || userEmail;
      } catch (e) {
        logger.warn('Could not fetch user email', { error: e });
      }

      // Return success page with refresh token
      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>OAuth Success</title>
            <style>
              body {
                font-family: Arial, sans-serif;
                max-width: 900px;
                margin: 50px auto;
                padding: 20px;
                background: #f5f5f5;
              }
              .container {
                background: white;
                padding: 30px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
              }
              h1 { color: #4CAF50; }
              h2 { color: #333; margin-top: 30px; }
              .token-box {
                background: #f9f9f9;
                border: 2px solid #4CAF50;
                padding: 20px;
                border-radius: 4px;
                margin: 20px 0;
                word-break: break-all;
                font-family: 'Courier New', monospace;
                font-size: 13px;
                position: relative;
              }
              .copy-btn {
                position: absolute;
                top: 10px;
                right: 10px;
                background: #4CAF50;
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
              }
              .copy-btn:hover {
                background: #45a049;
              }
              .warning {
                background: #fff3cd;
                border-left: 4px solid #ffc107;
                padding: 15px;
                border-radius: 4px;
                margin: 20px 0;
              }
              .instructions {
                background: #e3f2fd;
                border-left: 4px solid #2196F3;
                padding: 20px;
                border-radius: 4px;
                margin: 20px 0;
              }
              .instructions ol {
                margin: 10px 0;
                padding-left: 20px;
              }
              .instructions li {
                margin: 10px 0;
                line-height: 1.6;
              }
              code {
                background: #f5f5f5;
                padding: 2px 6px;
                border-radius: 3px;
                font-family: 'Courier New', monospace;
                color: #d32f2f;
              }
              .command-box {
                background: #263238;
                color: #aed581;
                padding: 20px;
                border-radius: 4px;
                margin: 15px 0;
                font-family: 'Courier New', monospace;
                font-size: 13px;
                overflow-x: auto;
                position: relative;
              }
              .success-icon {
                font-size: 48px;
                text-align: center;
                margin: 20px 0;
              }
              pre {
                margin: 0;
                white-space: pre-wrap;
              }
            </style>
            <script>
              function copyToken() {
                const token = document.getElementById('refresh-token').textContent;
                navigator.clipboard.writeText(token).then(() => {
                  const btn = document.getElementById('copy-btn');
                  btn.textContent = '✓ Copied!';
                  setTimeout(() => {
                    btn.textContent = '📋 Copy';
                  }, 2000);
                });
              }

              function copyCommand() {
                const command = document.getElementById('curl-command').textContent;
                navigator.clipboard.writeText(command).then(() => {
                  const btn = document.getElementById('copy-cmd-btn');
                  btn.textContent = '✓ Copied!';
                  setTimeout(() => {
                    btn.textContent = '📋 Copy';
                  }, 2000);
                });
              }
            </script>
          </head>
          <body>
            <div class="container">
              <div class="success-icon">✅</div>
              <h1>OAuth Authentication Successful!</h1>

              <div class="warning">
                <strong>⚠️ Security Warning:</strong>
                <ul>
                  <li>Keep this refresh token secure!</li>
                  <li>Never commit it to version control</li>
                  <li>Never share it publicly</li>
                  <li>Store it only in your local <code>.env</code> file</li>
                </ul>
              </div>

              <h2>📧 Authenticated Email:</h2>
              <div class="token-box">
                <strong>${userEmail}</strong>
              </div>

              <h2>🔑 Your Refresh Token:</h2>
              <div class="token-box">
                <button class="copy-btn" id="copy-btn" onclick="copyToken()">📋 Copy</button>
                <div id="refresh-token">${refreshToken || 'No refresh token received. Try authenticating again with prompt=consent.'}</div>
              </div>

              ${!refreshToken ? `
                <div class="warning">
                  <strong>⚠️ No Refresh Token Received</strong>
                  <p>This can happen if you've authorized this app before. To fix:</p>
                  <ol>
                    <li>Go to <a href="https://myaccount.google.com/permissions" target="_blank">Google Account Permissions</a></li>
                    <li>Remove "MyWallet Gmail Sync"</li>
                    <li>Go back and <a href="/api/auth/gmail">try again</a></li>
                  </ol>
                </div>
              ` : ''}

              <div class="instructions">
                <h3>📝 Next Steps:</h3>
                <ol>
                  <li><strong>Copy the refresh token above</strong> (click the Copy button)</li>
                  <li><strong>Open your <code>.env</code> file</strong> in the project root</li>
                  <li><strong>Update the line:</strong>
                    <div class="command-box">GMAIL_REFRESH_TOKEN=${refreshToken || 'YOUR_REFRESH_TOKEN_HERE'}</div>
                  </li>
                  <li><strong>Save the file</strong></li>
                  <li><strong>Restart your API server and Worker</strong>:
                    <div class="command-box">
# In API terminal: Press Ctrl+C, then:
cd packages/backend-apis
npm run dev

# In Worker terminal: Press Ctrl+C, then:
cd packages/temporal-worker
npm run dev
                    </div>
                  </li>
                  <li><strong>Test by linking your Gmail account</strong></li>
                </ol>
              </div>

              <h2>🧪 Test Command (use Postman or curl):</h2>
              <div class="command-box">
                <button class="copy-btn" id="copy-cmd-btn" onclick="copyCommand()" style="background: #2196F3;">📋 Copy</button>
                <pre id="curl-command">curl -X POST http://localhost:3000/api/gmail/link \\
  -H "Content-Type: application/json" \\
  -d '{
    "userId": "test-user-123",
    "email": "${userEmail}",
    "refreshToken": "${refreshToken || 'YOUR_REFRESH_TOKEN'}",
    "pubSubTopicName": "${process.env.PUBSUB_TOPIC_NAME || 'projects/YOUR_PROJECT/topics/gmail-notifications'}"
  }'</pre>
              </div>

              <div class="instructions">
                <h3>✅ Verification:</h3>
                <p>After linking, verify the workflow is running:</p>
                <ul>
                  <li>Open Temporal UI: <a href="http://localhost:8233" target="_blank">http://localhost:8233</a></li>
                  <li>Look for workflow: <code>gmail-subscription-test-user-123</code></li>
                  <li>Status should be: <strong>Running</strong></li>
                </ul>
              </div>

              <p style="text-align: center; margin-top: 40px;">
                <a href="/api/health">← Back to API</a> |
                <a href="http://localhost:8233" target="_blank">Open Temporal UI →</a>
              </p>
            </div>
          </body>
        </html>
      `);
    } catch (error) {
      logger.error('OAuth callback failed', { error });
      res.status(500).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>OAuth Error</title>
            <style>
              body {
                font-family: Arial, sans-serif;
                max-width: 800px;
                margin: 50px auto;
                padding: 20px;
              }
              .error-box {
                background: #ffebee;
                border-left: 4px solid #f44336;
                padding: 20px;
                border-radius: 4px;
              }
              h1 { color: #f44336; }
              pre {
                background: #f5f5f5;
                padding: 15px;
                border-radius: 4px;
                overflow-x: auto;
              }
            </style>
          </head>
          <body>
            <div class="error-box">
              <h1>❌ Failed to Exchange Authorization Code</h1>
              <p><strong>Error:</strong> ${(error as Error).message}</p>
              <h3>Common causes:</h3>
              <ul>
                <li>Invalid Client ID or Client Secret in .env</li>
                <li>Redirect URI mismatch in Google Cloud Console</li>
                <li>Authorization code already used or expired</li>
              </ul>
              <h3>Error details:</h3>
              <pre>${JSON.stringify(error, null, 2)}</pre>
              <p><a href="/api/auth/gmail">← Try again</a></p>
            </div>
          </body>
        </html>
      `);
    }
  }
}
