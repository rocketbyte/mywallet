import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { emailProviders } from '../providers';

const router = Router();
const controller = new AuthController(emailProviders);

/**
 * @openapi
 * /auth/connect:
 *   post:
 *     summary: Subscribe an email account for incoming-mail listening
 *     description: |
 *       Returns the OAuth authorization URL for the requested email provider.
 *       The caller's authenticated `userId` and the supplied `email` are embedded
 *       in the OAuth `state`, so once the user grants consent the callback links
 *       the account automatically and starts the Temporal sync workflow.
 *
 *       Frontends typically open `authUrl` in a popup; the callback closes the
 *       popup after auto-linking.
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, provider]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: user@gmail.com
 *               provider:
 *                 type: string
 *                 enum: [gmail, outlook]
 *                 example: gmail
 *     responses:
 *       200:
 *         description: Authorization URL returned.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 authUrl: { type: string }
 *                 provider: { type: string }
 *                 email: { type: string }
 *       400:
 *         description: Invalid input or unsupported provider.
 *       401:
 *         description: Missing or invalid authentication.
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/connect', (req, res) => controller.connect(req, res));

/**
 * @openapi
 * /auth/{provider}/callback:
 *   get:
 *     summary: OAuth callback (called by the provider — do not call directly)
 *     description: |
 *       Each registered provider has its own redirect URI configured in its OAuth
 *       app console; that URI must point here. The callback decodes the OAuth
 *       `state`, exchanges the authorization code, and auto-links the account.
 *     tags: [Auth]
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema: { type: string, enum: [gmail, outlook] }
 *       - in: query
 *         name: code
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: state
 *         schema: { type: string }
 *       - in: query
 *         name: error
 *         schema: { type: string }
 *     responses:
 *       200: { description: HTML success page }
 *       400: { description: Missing code or unknown provider }
 *       500: { description: Token exchange failed }
 */
router.get('/:provider/callback', (req, res) => controller.handleCallback(req, res));

/**
 * @openapi
 * /auth/gmail:
 *   get:
 *     deprecated: true
 *     summary: '[Deprecated] Get Gmail OAuth URL — use POST /auth/connect'
 *     description: |
 *       Retained only for backward compatibility with existing manual flows.
 *       New integrations must call `POST /api/auth/connect` with `{ email, provider }`.
 *     tags: [Auth]
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema: { type: string }
 *       - in: query
 *         name: email
 *         schema: { type: string, format: email }
 *     responses:
 *       200: { description: HTML page or `{ authUrl, provider, deprecated }` JSON }
 */
router.get('/gmail', (req, res) => controller.getAuthUrlLegacy(req, res));

export default router;
