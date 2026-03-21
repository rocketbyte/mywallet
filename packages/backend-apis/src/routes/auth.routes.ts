import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';

const router = Router();
const controller = new AuthController();

/**
 * @openapi
 * /auth/gmail:
 *   get:
 *     summary: Get Gmail OAuth authorization URL
 *     description: |
 *       Returns the Google OAuth2 authorization URL to initiate Gmail access.
 *       Open the returned `authUrl` in a browser to grant access — Google will
 *       redirect to `/auth/gmail/callback` where the refresh token is displayed.
 *     tags: [Gmail]
 *     responses:
 *       200:
 *         description: OAuth authorization URL.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 authUrl:
 *                   type: string
 *                   description: Open this URL in a browser to start the OAuth flow.
 *                   example: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=...'
 *                 instructions:
 *                   type: array
 *                   items:
 *                     type: string
 *                   example:
 *                     - '1. Open the authUrl in your browser'
 *                     - '2. Sign in with your Google account'
 *                     - '3. Copy the refresh token shown on the callback page'
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
 *       Google redirects here after the user grants access. Exchanges the
 *       authorization code for a refresh token and returns an HTML page
 *       displaying the token to copy into your configuration.
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
 *     responses:
 *       200:
 *         description: HTML page showing the refresh token and next steps.
 *       400:
 *         description: Missing or invalid authorization code.
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/gmail/callback', (req, res) => controller.handleCallback(req, res));

export default router;
