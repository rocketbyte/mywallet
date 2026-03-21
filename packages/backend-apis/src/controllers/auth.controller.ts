import { Request, Response } from 'express';
import { IEmailProvider } from '../providers/types';
import { logger } from '../utils/logger';

/**
 * Handles the two-step OAuth flow for any email provider.
 * Provider-specific logic lives in the IEmailProvider implementation —
 * this controller stays clean and generic.
 *
 * Auto-link flow:
 *   GET /api/auth/gmail?userId=<id>
 *     → embeds userId in OAuth state
 *     → Google redirects to callback with state
 *   GET /api/auth/gmail/callback?code=<code>&state=<encoded>
 *     → decodes userId from state
 *     → exchanges code → gets email + refresh token
 *     → auto-calls provider.linkAccount() so sync starts immediately
 */
export class AuthController {
  constructor(private readonly provider: IEmailProvider) {}

  /**
   * GET /api/auth/:provider
   * Returns (or redirects to) the OAuth authorization URL.
   * Pass `?userId=<id>` to enable auto-linking on the callback.
   */
  getAuthUrl(req: Request, res: Response): void {
    try {
      const userId = req.query.userId as string | undefined;
      const authUrl = this.provider.getAuthUrl(userId);

      logger.info('Generated OAuth URL', { provider: this.provider.type, userId });

      if (req.headers.accept?.includes('application/json')) {
        res.json({ authUrl, provider: this.provider.type });
        return;
      }

      res.send(buildAuthPage(authUrl, userId));
    } catch (error) {
      logger.error('Failed to generate auth URL', { error });
      res.status(500).json({ error: 'Failed to generate authorization URL', message: (error as Error).message });
    }
  }

  /**
   * GET /api/auth/:provider/callback
   * Google redirects here after the user grants consent.
   * If the OAuth state contains a userId the account is linked automatically.
   */
  async handleCallback(req: Request, res: Response): Promise<void> {
    const { code, error, state } = req.query;

    if (error) {
      logger.error('OAuth authorization failed', { error });
      res.status(400).send(buildErrorPage(String(error)));
      return;
    }

    if (!code) {
      res.status(400).send(buildErrorPage('No authorization code provided.'));
      return;
    }

    // Decode userId embedded in state (if present)
    let userId: string | undefined;
    if (state) {
      try {
        const decoded = JSON.parse(Buffer.from(state as string, 'base64').toString('utf-8'));
        userId = decoded.userId;
      } catch {
        logger.warn('Could not decode OAuth state', { state });
      }
    }

    try {
      const { email, refreshToken } = await this.provider.exchangeCode(code as string);

      logger.info('OAuth code exchanged successfully', {
        provider: this.provider.type,
        email,
        autoLink: !!userId
      });

      // Auto-link if userId was passed through the OAuth flow
      if (userId) {
        try {
          const result = await this.provider.linkAccount({ userId, email, refreshToken });
          logger.info('Account auto-linked after OAuth', { userId, workflowId: result.workflowId });
          res.send(buildAutoLinkedPage(email, userId, result.workflowId));
        } catch (linkErr) {
          logger.error('Auto-link failed after OAuth', { userId, error: linkErr });
          // Fall back to manual page so the user still has their token
          res.send(buildManualTokenPage(email, refreshToken, userId, (linkErr as Error).message));
        }
        return;
      }

      // No userId — show the token so the user can link manually
      res.send(buildManualTokenPage(email, refreshToken));
    } catch (error) {
      logger.error('OAuth callback failed', { error });
      res.status(500).send(buildCallbackErrorPage((error as Error).message));
    }
  }
}

// ─── HTML helpers ────────────────────────────────────────────────────────────
// Kept minimal and purposeful — they only render what each scenario needs.

const baseStyle = `
  body { font-family: Arial, sans-serif; max-width: 900px; margin: 50px auto; padding: 20px; background: #f5f5f5; }
  .card { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,.1); }
  h1 { margin-top: 0; }
  .info  { background: #e3f2fd; border-left: 4px solid #2196F3; padding: 15px; border-radius: 4px; margin: 16px 0; }
  .warn  { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; border-radius: 4px; margin: 16px 0; }
  .error { background: #ffebee; border-left: 4px solid #f44336; padding: 15px; border-radius: 4px; margin: 16px 0; }
  .token { background: #f9f9f9; border: 2px solid #4CAF50; padding: 16px; border-radius: 4px; word-break: break-all;
           font-family: monospace; font-size: 13px; position: relative; margin: 16px 0; }
  .btn { display: inline-block; padding: 12px 24px; border-radius: 4px; font-size: 15px;
         text-decoration: none; cursor: pointer; border: none; }
  .btn-primary { background: #4285f4; color: white; }
  .btn-primary:hover { background: #357ae8; }
  .btn-copy { position: absolute; top: 10px; right: 10px; background: #4CAF50; color: white;
              padding: 6px 14px; border-radius: 4px; cursor: pointer; border: none; font-size: 12px; }
  code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-family: monospace; color: #d32f2f; }
`;

function buildAuthPage(authUrl: string, userId?: string): string {
  const autoNote = userId
    ? `<div class="info"><strong>Auto-link enabled:</strong> After granting access, your Gmail account will be linked automatically for user <code>${userId}</code>.</div>`
    : `<div class="warn">No <code>userId</code> provided. You will receive a refresh token to link manually.</div>`;

  return `<!DOCTYPE html><html><head><title>Gmail OAuth</title><style>${baseStyle}</style></head>
  <body><div class="card">
    <h1 style="color:#4285f4">🔐 Gmail Authorization</h1>
    ${autoNote}
    <a href="${authUrl}" class="btn btn-primary">Authorize Gmail Access</a>
    <details style="margin-top:20px"><summary>Show authorization URL</summary>
      <code style="word-break:break-all;display:block;margin-top:8px">${authUrl}</code>
    </details>
  </div></body></html>`;
}

function buildAutoLinkedPage(email: string, userId: string, workflowId: string): string {
  return `<!DOCTYPE html><html><head><title>Linked</title><style>${baseStyle}</style></head>
  <body><div class="card">
    <h1 style="color:#4CAF50">✅ Gmail Account Linked</h1>
    <div class="info">
      <strong>Email:</strong> ${email}<br>
      <strong>User ID:</strong> ${userId}<br>
      <strong>Workflow ID:</strong> <code>${workflowId}</code>
    </div>
    <p>Your Gmail account is now syncing. The Temporal workflow is running and listening for new emails via Pub/Sub.</p>
    <a href="/api/gmail/status/${userId}" class="btn btn-primary">Check Sync Status</a>
  </div></body></html>`;
}

function buildManualTokenPage(email: string, refreshToken: string, userId?: string, linkError?: string): string {
  const errorNote = linkError
    ? `<div class="error"><strong>Auto-link failed:</strong> ${linkError}<br>Copy the token below and link manually.</div>`
    : '';

  const curlExample = userId
    ? `curl -X POST /api/gmail/link -H 'Content-Type: application/json' -d '{"userId":"${userId}","email":"${email}","refreshToken":"TOKEN"}'`
    : `curl -X POST /api/gmail/link -H 'Content-Type: application/json' -d '{"userId":"YOUR_USER_ID","email":"${email}","refreshToken":"TOKEN"}'`;

  return `<!DOCTYPE html><html><head><title>OAuth Success</title><style>${baseStyle}</style>
  <script>
    function copy(id, btn) {
      navigator.clipboard.writeText(document.getElementById(id).textContent).then(() => {
        btn.textContent = '✓ Copied'; setTimeout(() => btn.textContent = 'Copy', 2000);
      });
    }
  </script></head>
  <body><div class="card">
    <h1 style="color:#4CAF50">✅ Authorization Successful</h1>
    ${errorNote}
    <div class="warn"><strong>Keep this token secure.</strong> Never commit it to version control.</div>
    <p><strong>Email:</strong> ${email}</p>
    <h3>Refresh Token</h3>
    <div class="token">
      <button class="btn-copy" onclick="copy('token',this)">Copy</button>
      <span id="token">${refreshToken}</span>
    </div>
    <h3>Link manually</h3>
    <div style="background:#263238;color:#aed581;padding:16px;border-radius:4px;font-family:monospace;font-size:13px;overflow-x:auto">
      <button class="btn-copy" style="background:#2196F3" onclick="copy('curl',this)">Copy</button>
      <span id="curl">${curlExample}</span>
    </div>
  </div></body></html>`;
}

function buildErrorPage(message: string): string {
  return `<!DOCTYPE html><html><head><title>OAuth Error</title><style>${baseStyle}</style></head>
  <body><div class="card error">
    <h1 style="color:#f44336">❌ Authorization Failed</h1>
    <p>${message}</p>
    <a href="/api/auth/gmail">Try again</a>
  </div></body></html>`;
}

function buildCallbackErrorPage(message: string): string {
  return `<!DOCTYPE html><html><head><title>OAuth Error</title><style>${baseStyle}</style></head>
  <body><div class="card error">
    <h1 style="color:#f44336">❌ Failed to Exchange Authorization Code</h1>
    <p>${message}</p>
    <h3>Common causes</h3>
    <ul>
      <li>Invalid Client ID or Secret</li>
      <li>Redirect URI mismatch in Google Cloud Console</li>
      <li>Authorization code already used or expired</li>
    </ul>
    <a href="/api/auth/gmail">Try again</a>
  </div></body></html>`;
}
