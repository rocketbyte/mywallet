import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { gmailProvider } from '../providers';

const router = Router();
const controller = new AuthController(gmailProvider);

/**
 * @openapi
 * /auth/gmail:
 *   get:
 *     summary: Get Gmail OAuth authorization URL
 *     description: |
 *       Returns the Google OAuth2 authorization URL to initiate Gmail access.
 *
 *       **Auto-link flow**: pass `?userId=<id>` to embed the user identifier in the
 *       OAuth `state`. The callback will then automatically link the account and start
 *       the Temporal sync workflow — no extra API call required.
 *
 *       **Manual flow**: omit `userId`. The callback page will display the refresh token
 *       so you can call `POST /gmail/link` yourself.
 *     tags: [Gmail]
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: |
 *           When provided, the account is auto-linked after the user grants consent.
 *         example: user_123
 *     responses:
 *       200:
 *         description: OAuth authorization URL (JSON) or authorization HTML page.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 authUrl:
 *                   type: string
 *                   description: Open this URL in a browser to start the OAuth flow.
 *                   example: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=...'
 *                 provider:
 *                   type: string
 *                   example: gmail
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/gmail', (req, res) => controller.getAuthUrl(req, res));

/**
 * @openapi
 * /auth/gmail/callback:
 *   get:
 *     summary: Gmail OAuth callback
 *     description: |
 *       Google redirects here after the user grants (or denies) access.
 *
 *       - If `state` contains a `userId` (set by `GET /auth/gmail?userId=<id>`), the
 *         account is auto-linked and the Temporal sync workflow starts immediately.
 *       - Otherwise, the refresh token is displayed so the caller can link manually
 *         via `POST /gmail/link`.
 *
 *       **This endpoint is called by Google — do not call it directly.**
 *     tags: [Gmail]
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: Authorization code provided by Google.
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *         description: Base64-encoded JSON containing `userId` and `provider`.
 *       - in: query
 *         name: error
 *         schema:
 *           type: string
 *         description: Set by Google when the user denies access.
 *     responses:
 *       200:
 *         description: |
 *           HTML page — either a success/auto-linked confirmation or a page
 *           displaying the refresh token for manual linking.
 *       400:
 *         description: Missing or invalid authorization code.
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/gmail/callback', (req, res) => controller.handleCallback(req, res));

export default router;
