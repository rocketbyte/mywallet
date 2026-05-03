/**
 * HTML responses returned by the OAuth callback. Kept in a separate module
 * so AuthController stays focused on flow control (SRP).
 */

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

export function renderAutoLinkedPage(provider: string, email: string, userId: string, workflowId: string): string {
  return `<!DOCTYPE html><html><head><title>Linked</title><style>${baseStyle}</style></head>
  <body><div class="card">
    <h1 style="color:#4CAF50">✅ Account Linked</h1>
    <div class="info">
      <strong>Provider:</strong> ${provider}<br>
      <strong>Email:</strong> ${email}<br>
      <strong>User ID:</strong> ${userId}<br>
      <strong>Workflow ID:</strong> <code>${workflowId}</code>
    </div>
    <p>Your account is now syncing. The Temporal workflow is running and listening for new emails.</p>
    <a href="/api/${provider}/status/${userId}" class="btn btn-primary">Check Sync Status</a>
  </div></body></html>`;
}

export function renderManualTokenPage(
  provider: string,
  email: string,
  refreshToken: string,
  userId?: string,
  linkError?: string,
): string {
  const errorNote = linkError
    ? `<div class="error"><strong>Auto-link failed:</strong> ${linkError}<br>Copy the token below and link manually.</div>`
    : '';

  const curlPayload = JSON.stringify({
    userId: userId ?? 'YOUR_USER_ID',
    email,
    refreshToken: 'TOKEN',
  });
  const curlExample = `curl -X POST /api/${provider}/link -H 'Content-Type: application/json' -d '${curlPayload}'`;

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

export function renderErrorPage(message: string): string {
  return `<!DOCTYPE html><html><head><title>OAuth Error</title><style>${baseStyle}</style></head>
  <body><div class="card error">
    <h1 style="color:#f44336">❌ Authorization Failed</h1>
    <p>${message}</p>
  </div></body></html>`;
}

export function renderCallbackErrorPage(message: string): string {
  return `<!DOCTYPE html><html><head><title>OAuth Error</title><style>${baseStyle}</style></head>
  <body><div class="card error">
    <h1 style="color:#f44336">❌ Failed to Exchange Authorization Code</h1>
    <p>${message}</p>
    <h3>Common causes</h3>
    <ul>
      <li>Invalid Client ID or Secret</li>
      <li>Redirect URI mismatch in the provider console</li>
      <li>Authorization code already used or expired</li>
    </ul>
  </div></body></html>`;
}
